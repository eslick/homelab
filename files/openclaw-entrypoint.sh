#!/bin/sh
# Wrapper entrypoint for openclaw-gateway.
# Starts the Manifest loopback relay (socat) then execs the original entrypoint.
socat TCP-LISTEN:2100,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:2099 &
exec docker-entrypoint.sh "$@"
