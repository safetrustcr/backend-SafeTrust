import {
  __resetChunkProcessorForTests,
  __setChunkProcessorForTests,
  isRustChunkProcessingEnabled,
  processChunksWithRust,
} from '../rust-chunk.adapter'

describe('Rust chunk adapter', () => {
  afterEach(() => {
    delete process.env.RUST_CHUNKS_ENABLED
    __resetChunkProcessorForTests()
  })

  it('dispatches chunk processing through an injected addon', async () => {
    const processChunksParallel = jest.fn(async () => '[]')
    __setChunkProcessorForTests({ processChunksParallel })
    process.env.RUST_CHUNKS_ENABLED = 'true'

    expect(isRustChunkProcessingEnabled()).toBe(true)
    await expect(processChunksWithRust([['C1']])).resolves.toBe('[]')
    expect(processChunksParallel).toHaveBeenCalledTimes(1)
  })
})
