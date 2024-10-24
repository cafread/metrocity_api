## API Purpose
Delivers [metro city](https://github.com/cafread/metrocity2024) bulk results, using optional country code to better handle complex borders.
Can respond to one request per call or hundreds of thousands, utilising cache to reduce resource calls and execution time.
Written in TypeScript for [Deno 2](https://deno.com/blog/v2.0).

## Expects
Serves on `127.0.0.1:3000` (set in the Docker image for production).
`POST` request only using the `/mc_api` route.
Requires the header `Content-Type: application/json`
Request body should be an array with elements `{"id": strInt, "lat": number, "lon": number, "cc"?: string}`
The `id` property needs to be unique and can be an integer or a string.
Due to projection constrained, `lat` must be between -85 and +85.
The `cc` property (ISO 3166-1 alpha-2) is optional.
If this array is empty, the test dataset will be used.

## Returns
A JSON object keyed on `id` with the value being the metro city name (empty string when none is found).
The unique `id` property is the same as that provided in the request, a string or integer as desired.

## Running
With Deno installed, from the repository folder execute:
`deno run --allow-net --watch server.ts`
Use [postman](https://www.postman.com/) or [hoppscotch](https://hoppscotch.io/), to send a post request as detailed above.

### Notes
Pulls the latest tiles as needed and caches the data, cache does not persist if the server is restarted. Because of this, warm runs will complete in a few ms versus a few seconds for larger cold runs.