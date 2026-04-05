#!/bin/sh
# Wrapper entrypoint for openclaw-gateway.
# Starts the Manifest loopback relay (socat) then execs the original entrypoint.
pkill -f 'socat TCP-LISTEN:2100' 2>/dev/null || true
nohup socat TCP-LISTEN:2100,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:2099 </dev/null >/dev/null 2>&1 &
exec docker-entrypoint.sh "$@"
