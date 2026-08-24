//! chunk-processor — concurrent escrow-chunk fetcher for SafeTrust reconciliation.
//!
//! Replaces the sequential `for` loop in `webhook/src/lib/reconciliation.js` that
//! calls the TrustlessWork indexer one chunk at a time. Each chunk is an
//! independent HTTP round-trip, so the work is network-bound and embarrassingly
//! parallel — a perfect fit for Tokio's async executor, which drives many
//! in-flight requests on a small thread pool without blocking Node's event loop
//! per request.
//!
//! # Exposed function (via Neon / Node-API v6)
//!
//! ```text
//! processChunksParallel(
//!   chunksJson:     string,   // JSON: string[][] — array of contract-id chunks
//!   apiUrl:         string,   // TrustlessWork base URL
//!   apiKey:         string,   // x-api-key header (omitted when empty)
//!   maxConcurrency: number,   // max in-flight chunk requests
//!   timeoutMs:      number,   // hard per-chunk deadline
//! ) => Promise<string>        // JSON: ChunkSyncResult[] — one entry per chunk
//! ```
//!
//! # Design contract (mirrors the JavaScript path it replaces)
//!
//! * **Chunk isolation** — one failed chunk never aborts the others. Failures are
//!   captured in `ChunkSyncResult.error`; the crate itself never throws for a
//!   network/parse failure (it only throws for a caller bug, e.g. malformed
//!   `chunksJson`, matching the previous JS behaviour of surfacing bad input).
//! * **Lossless pass-through** — escrow objects are returned to JS *verbatim* as
//!   parsed JSON (`serde_json::Value`), so the existing UPSERT keeps writing
//!   every field it did before (`amount`, `roles.{marker,approver,releaser}`,
//!   `escrowType`, …). The DB layer is intentionally left in JavaScript.
//! * **Response-shape tolerance** — the indexer may return `{ "escrows": [...] }`
//!   or a bare `[...]`; both are accepted, exactly like `fetchEscrowsByContractIds`.

use futures::stream::{self, StreamExt};
use neon::prelude::*;
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::runtime::Runtime;

/// Path segment appended to the TrustlessWork base URL. Kept in sync with
/// `fetchEscrowsByContractIds` in `webhook/src/lib/reconciliation.js`.
const INDEXER_PATH: &str = "/helper/get-escrows-by-contract-ids";

/// Result of processing a single chunk. Serialised into the JSON array returned
/// to JavaScript. `escrows` carries the raw indexer objects so the JS UPSERT is
/// byte-for-byte unchanged.
#[derive(Serialize, Debug)]
struct ChunkSyncResult {
    chunk_index: usize,
    fetched: usize,
    duration_ms: u64,
    error: Option<String>,
    escrows: Vec<Value>,
}

// ─── Shared, lazily-initialised runtime & HTTP client ─────────────────────────
// One multi-thread Tokio runtime and one connection-pooling reqwest client are
// reused across every call. Rebuilding them per invocation (as a naive port
// would) throws away the connection pool and re-spins the thread pool on every
// sync — measurable overhead on the hot path this crate exists to speed up.

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        Runtime::new().expect("failed to initialise Tokio runtime for chunk-processor")
    })
}

fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .build()
            .expect("failed to build reqwest client for chunk-processor")
    })
}

// ─── Pure logic (unit-tested without a Node.js runtime or network) ────────────

/// Parse the `chunksJson` argument into `Vec<Vec<String>>`.
fn parse_chunks(chunks_json: &str) -> Result<Vec<Vec<String>>, String> {
    serde_json::from_str(chunks_json)
        .map_err(|e| format!("invalid chunks JSON: {e}"))
}

/// Normalise the indexer response body into a flat list of escrow objects.
///
/// Accepts either `{ "escrows": [...] }` or a bare `[...]` — the two shapes the
/// TrustlessWork indexer is known to return — and rejects anything else with the
/// same wording the JS layer used, so log greps keep working.
fn normalize_escrows(body: Value) -> Result<Vec<Value>, String> {
    match body {
        Value::Array(items) => Ok(items),
        Value::Object(mut map) => match map.remove("escrows") {
            Some(Value::Array(items)) => Ok(items),
            _ => Err(unexpected_shape(&Value::Object(map))),
        },
        other => Err(unexpected_shape(&other)),
    }
}

fn unexpected_shape(body: &Value) -> String {
    let mut preview = body.to_string();
    preview.truncate(200);
    format!("Unexpected TrustlessWork API response shape: {preview}")
}

/// Build the indexer URL for a base URL, tolerating a trailing slash.
fn build_url(api_url: &str) -> String {
    format!("{}{}", api_url.trim_end_matches('/'), INDEXER_PATH)
}

// ─── Async fetch + concurrency ────────────────────────────────────────────────

/// Fetch a single chunk from the indexer. Never panics — every failure mode maps
/// to a descriptive `Err(String)` that becomes `ChunkSyncResult.error`.
async fn fetch_chunk(
    client: &Client,
    api_url: &str,
    api_key: &str,
    chunk: &[String],
    timeout: Duration,
) -> Result<Vec<Value>, String> {
    let url = build_url(api_url);

    let mut request = client
        .get(&url)
        .timeout(timeout) // reqwest per-request timeout (whole request incl. body)
        .query(&[("contractIds", chunk.join(","))]);

    // Match the JS helper: only send x-api-key when a key is configured.
    if !api_key.is_empty() {
        request = request.header("x-api-key", api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        // Include a short body snippet for diagnosability, like the JS path.
        let body = response.text().await.unwrap_or_default();
        let mut snippet = body;
        snippet.truncate(200);
        return Err(format!(
            "TrustlessWork API responded with status {status}: {snippet}"
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse TrustlessWork API response: {e}"))?;

    normalize_escrows(body)
}

/// Process every chunk with at most `max_concurrency` requests in flight.
///
/// Uses `buffer_unordered` for true streaming bounded concurrency (a new request
/// starts the instant a slot frees up) rather than fixed batch barriers, which
/// would stall an entire batch on its slowest chunk. Each future carries its
/// `chunk_index`, and the collected results are re-sorted by it so the output
/// order is deterministic regardless of completion order.
async fn process_chunks(
    chunks: Vec<Vec<String>>,
    api_url: String,
    api_key: String,
    max_concurrency: usize,
    timeout_ms: u64,
) -> Vec<ChunkSyncResult> {
    let client = http_client();
    let timeout = Duration::from_millis(timeout_ms);
    // `buffer_unordered(0)` would mean "unbounded"; a misconfigured 0 must not
    // silently unleash unlimited concurrency at the indexer.
    let concurrency = max_concurrency.max(1);

    let mut results: Vec<ChunkSyncResult> = stream::iter(chunks.into_iter().enumerate())
        .map(|(chunk_index, chunk)| {
            let api_url = api_url.clone();
            let api_key = api_key.clone();
            async move {
                let started = Instant::now();

                // Hard per-chunk deadline: even if the reqwest timeout is evaded
                // (e.g. a slow TLS handshake), tokio::time::timeout guarantees the
                // chunk resolves within timeout_ms.
                let outcome =
                    tokio::time::timeout(timeout, fetch_chunk(client, &api_url, &api_key, &chunk, timeout))
                        .await
                        .unwrap_or_else(|_| {
                            Err(format!("chunk timed out after {timeout_ms}ms"))
                        });

                let duration_ms = started.elapsed().as_millis() as u64;
                match outcome {
                    Ok(escrows) => ChunkSyncResult {
                        chunk_index,
                        fetched: escrows.len(),
                        duration_ms,
                        error: None,
                        escrows,
                    },
                    Err(error) => ChunkSyncResult {
                        chunk_index,
                        fetched: 0,
                        duration_ms,
                        error: Some(error),
                        escrows: Vec::new(),
                    },
                }
            }
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    results.sort_by_key(|r| r.chunk_index);
    results
}

// ─── Neon export ──────────────────────────────────────────────────────────────

/// `processChunksParallel(chunksJson, apiUrl, apiKey, maxConcurrency, timeoutMs)`.
///
/// Returns a `Promise<string>` and does NOT block the Node.js event loop. The
/// chunk fetches run on the shared Tokio runtime's own threads; when they finish
/// the promise is settled back on the JS thread via a Neon `Channel`. So while a
/// sync is in flight the event loop stays free to serve other requests, and the
/// wall-clock time (which can exceed a single `timeoutMs` when chunks run in
/// waves) never stalls unrelated work.
///
/// The returned promise rejects only for a caller bug (malformed `chunksJson`);
/// all network/parse failures are captured per-chunk in the resolved JSON.
fn process_chunks_parallel(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let chunks_json = cx.argument::<JsString>(0)?.value(&mut cx);
    let api_url = cx.argument::<JsString>(1)?.value(&mut cx);
    let api_key = cx.argument::<JsString>(2)?.value(&mut cx);
    let max_concurrency = cx.argument::<JsNumber>(3)?.value(&mut cx) as usize;
    let timeout_ms = cx.argument::<JsNumber>(4)?.value(&mut cx) as u64;

    let (deferred, promise) = cx.promise();
    let channel = cx.channel();

    // Parse up front so a malformed argument rejects the promise immediately,
    // without spawning any work.
    let chunks = match parse_chunks(&chunks_json) {
        Ok(chunks) => chunks,
        Err(e) => {
            let error = cx.error(e)?;
            deferred.reject(&mut cx, error);
            return Ok(promise);
        }
    };

    // Run the fetches on the Tokio runtime, then settle the promise on the JS
    // thread. `settle_with` schedules its closure on the event loop via `channel`.
    runtime().spawn(async move {
        let results = process_chunks(chunks, api_url, api_key, max_concurrency, timeout_ms).await;
        deferred.settle_with(&channel, move |mut cx| {
            let json = serde_json::to_string(&results)
                .or_else(|e| cx.throw_error(format!("failed to serialise results: {e}")))?;
            Ok(cx.string(json))
        });
    });

    Ok(promise)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("processChunksParallel", process_chunks_parallel)?;
    Ok(())
}

// ─── Unit tests (`cargo test`) ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_nested_chunk_arrays() {
        let chunks = parse_chunks(r#"[["a","b"],["c"]]"#).unwrap();
        assert_eq!(chunks, vec![vec!["a", "b"], vec!["c"]]);
    }

    #[test]
    fn parses_empty_chunk_list() {
        assert_eq!(parse_chunks("[]").unwrap(), Vec::<Vec<String>>::new());
    }

    #[test]
    fn rejects_malformed_chunk_json() {
        assert!(parse_chunks("{not json").is_err());
        // A flat array of strings is not the expected string[][] shape.
        assert!(parse_chunks(r#"["a","b"]"#).is_err());
    }

    #[test]
    fn normalizes_enveloped_response() {
        let body = json!({ "escrows": [{ "contractId": "C1" }, { "contractId": "C2" }] });
        let escrows = normalize_escrows(body).unwrap();
        assert_eq!(escrows.len(), 2);
        assert_eq!(escrows[0]["contractId"], "C1");
    }

    #[test]
    fn normalizes_bare_array_response() {
        let body = json!([{ "contractId": "C1" }]);
        let escrows = normalize_escrows(body).unwrap();
        assert_eq!(escrows.len(), 1);
    }

    #[test]
    fn passes_escrow_objects_through_losslessly() {
        // Fields the JS UPSERT depends on must survive verbatim, including the
        // string-encoded `amount` the indexer emits.
        let body = json!({ "escrows": [{
            "contractId": "C1",
            "status": "funded",
            "amount": "100.0000000",
            "balance": "50.0000000",
            "escrowType": "single_release",
            "roles": { "marker": "M", "approver": "A", "releaser": "R" }
        }]});
        let escrows = normalize_escrows(body).unwrap();
        let e = &escrows[0];
        assert_eq!(e["amount"], "100.0000000");
        assert_eq!(e["roles"]["approver"], "A");
        assert_eq!(e["escrowType"], "single_release");
    }

    #[test]
    fn rejects_unexpected_shapes() {
        assert!(normalize_escrows(json!({ "unexpected": true })).is_err());
        assert!(normalize_escrows(json!({ "escrows": "not-an-array" })).is_err());
        assert!(normalize_escrows(json!(42)).is_err());
        // Error wording matches the JS log line so alerts/greps keep working.
        let err = normalize_escrows(json!({ "unexpected": true })).unwrap_err();
        assert!(err.starts_with("Unexpected TrustlessWork API response shape:"));
    }

    #[test]
    fn builds_indexer_url_tolerating_trailing_slash() {
        assert_eq!(
            build_url("https://api.example.com"),
            "https://api.example.com/helper/get-escrows-by-contract-ids"
        );
        assert_eq!(
            build_url("https://api.example.com/"),
            "https://api.example.com/helper/get-escrows-by-contract-ids"
        );
    }

    #[tokio::test]
    async fn failed_chunks_are_isolated_and_indexed() {
        // Unroutable address → every chunk fails fast, but the call still returns
        // one result per chunk, each carrying its own error and correct index.
        let chunks = vec![vec!["a".to_string()], vec!["b".to_string()], vec!["c".to_string()]];
        let results = process_chunks(
            chunks,
            "http://127.0.0.1:0".to_string(), // port 0 is not connectable
            String::new(),
            2,
            200,
        )
        .await;

        assert_eq!(results.len(), 3);
        for (i, r) in results.iter().enumerate() {
            assert_eq!(r.chunk_index, i, "results must be ordered by chunk_index");
            assert!(r.error.is_some(), "unreachable host must yield a per-chunk error");
            assert_eq!(r.fetched, 0);
            assert!(r.escrows.is_empty());
        }
    }

    #[tokio::test]
    async fn zero_concurrency_is_clamped_not_unbounded() {
        // max_concurrency = 0 must be treated as 1, never as "unbounded".
        let chunks = vec![vec!["a".to_string()]];
        let results =
            process_chunks(chunks, "http://127.0.0.1:0".to_string(), String::new(), 0, 100).await;
        assert_eq!(results.len(), 1);
    }
}
