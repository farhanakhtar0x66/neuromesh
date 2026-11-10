# tiny-server

Starts on port 3000 unless the `PORT` environment variable is set.

    node -e "import('./src/server.js').then(m => m.start())"
    curl localhost:3000
