#!/bin/bash
HASURA_FOLDER=/app
cd $HASURA_FOLDER || {
    echo "Hasura folder '$HASURA_FOLDER' not found"
    exit 1
}

# Workaround for https://github.com/hasura/graphql-engine/issues/2824#issuecomment-801293056
socat TCP-LISTEN:8080,fork TCP:graphql-engine:8080 &
socat TCP-LISTEN:9695,fork,reuseaddr,bind=console TCP:127.0.0.1:9695 &
socat TCP-LISTEN:9693,fork,reuseaddr,bind=console TCP:127.0.0.1:9693 &

{
    # Skip migrations for safetrust since it will be created during tenant deployment
    echo "Skipping migrations for safetrust database as it will be created during tenant deployment"
    
    # Apply only metadata changes
    echo "Applying metadata..."
    
    # Run console if specified
    if [[ -v HASURA_RUN_CONSOLE ]]; then
        echo "Starting console..."
        hasura console --log-level DEBUG --address "127.0.0.1" --no-browser || exit 1
    else
        echo "Started without console"
        tail -f /dev/null
    fi
}