$headers = @{
    "X-Hasura-Admin-Secret" = "myadminsecretkey"
    "Content-Type" = "application/json"
}

$body = '{"type":"export_metadata","args":{}}'

$result = Invoke-RestMethod -Uri "http://localhost:8080/v1/metadata" -Method POST -Headers $headers -Body $body

$result.actions | ForEach-Object {
    Write-Host "Action: $($_.name)"
}
