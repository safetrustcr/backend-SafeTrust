$headers = @{
    "X-Hasura-Admin-Secret" = "myadminsecretkey"
    "Content-Type" = "application/json"
}

# Step 1: Create custom types
$customTypesBody = @{
    type = "set_custom_types"
    args = @{
        input_objects = @(
            @{
                name = "OpenDisputeInput"
                fields = @(
                    @{ name = "contractId"; type = "String!" },
                    @{ name = "senderAddress"; type = "String!" }
                )
            }
        )
        objects = @(
            @{
                name = "OpenDisputeOutput"
                fields = @(
                    @{ name = "contractId"; type = "String!" },
                    @{ name = "unsignedXdr"; type = "String!" }
                )
            }
        )
        scalars = @()
        enums = @()
    }
} | ConvertTo-Json -Depth 10

Write-Host "Registering custom types..."
try {
    $typesResp = Invoke-RestMethod -Uri "http://localhost:8080/v1/metadata" -Method POST -Headers $headers -Body $customTypesBody
    Write-Host "Custom types registered: $($typesResp | ConvertTo-Json)"
} catch {
    Write-Host "Custom types error (may already exist): $_"
}

# Step 2: Create the action
$actionBody = @{
    type = "create_action"
    args = @{
        name = "open_dispute"
        definition = @{
            kind = "synchronous"
            handler = "http://webhook:3001/api/escrow/dispute"
            forward_client_headers = $true
            type = "mutation"
            arguments = @(
                @{ name = "input"; type = "OpenDisputeInput!" }
            )
            output_type = "OpenDisputeOutput"
        }
    }
} | ConvertTo-Json -Depth 10

Write-Host "Creating action..."
try {
    $actionResp = Invoke-RestMethod -Uri "http://localhost:8080/v1/metadata" -Method POST -Headers $headers -Body $actionBody
    Write-Host "Action created: $($actionResp | ConvertTo-Json)"
} catch {
    Write-Host "Action error (may already exist): $_"
}

# Step 3: Create permission for 'user' role
$permBody = @{
    type = "create_action_permission"
    args = @{
        action = "open_dispute"
        role = "user"
    }
} | ConvertTo-Json -Depth 5

Write-Host "Adding user permission..."
try {
    $permResp = Invoke-RestMethod -Uri "http://localhost:8080/v1/metadata" -Method POST -Headers $headers -Body $permBody
    Write-Host "Permission added: $($permResp | ConvertTo-Json)"
} catch {
    Write-Host "Permission error (may already exist): $_"
}

Write-Host "Done!"
