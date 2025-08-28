# XML Persistence Server

A minimal Node server (no external dependencies) to read and write your XML files from/to disk.

## Endpoints

- GET  `/api/definitions` — returns `cfglimitsdefinition.xml`
- PUT  `/api/definitions` — writes request body as `cfglimitsdefinition.xml`
- GET  `/api/types/:group/:file` — returns `data/db/types/:group/:file.xml`
- PUT  `/api/types/:group/:file` — writes request body to `data/db/types/:group/:file.xml`

All responses for XML return `Content-Type: application/xml`.

Requests that write XML expect the raw XML string as the request body.

## Run
