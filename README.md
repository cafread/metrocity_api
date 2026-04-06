## API Purpose
Delivers [metro city](https://github.com/cafread/metrocity2024) bulk results, using optional country code to better handle complex borders.  
Can respond to one request per call or hundreds of thousands, utilising cache to reduce resource calls and execution time.  
Written in TypeScript for [Deno 2](https://deno.com/blog/v2.0).

## How to use it
For testing, an edge service is available: `https://metro-city.deno.dev/`  
`POST` request using the `/mc_api` route.  
Requires the header `Content-Type: application/json`  
Request body should be an array with elements `{"id": strInt, "lat": number, "lon": number, "cc"?: string}`  
The `id` property needs to be unique and can be an integer or a string.  
Due to projection constraints, `lat` should be between -85 and +85.  
The `cc` property (ISO 3166-1 alpha-2) is optional.  
If this array is empty, the test dataset will be used.  
Limited to 500 locations per request.

## Returns
A JSON object keyed on `id` with the value being the metro city name (empty string when none is found).  
The unique `id` property is the same as that provided in the request, a string or integer as desired.  

## GET Request Routes
`/status`    returns uptime and usage if the server is running  
`/info`      links here where the documentation resides  
`/version`   returns version information  
`/changelog` returns a unix timestamp for when each tile & metro city was last added / edited / deleted and a metro city id : name map

## Running Locally in Docker
Docker has been used for development and delivers a faster API for bulk requests than Deno Deploy  
When running locally, cache is rebuilt per run, so invalidation is not an issue   
Powershell commands:  
`docker build -t metrocity-api .`  
`docker run -p 3000:3000 --name metrocity metrocity-api`  

### Sample dockerfile:  
```
FROM denoland/deno:2.7.11
WORKDIR /app
COPY ./metrocity_api /app
RUN chown -R deno:deno /app
USER deno
RUN deno cache server.ts
EXPOSE 3000
CMD ["run", "--allow-net", "--allow-env=reqLim,auth", "server.ts"]
```

Use [postman](https://www.postman.com/) to send a post request as detailed above with the body set to raw / JSON and `content-type` of `application/json`.

## Notes
Pulls the latest tiles as needed and caches the data, cache does not persist if the server is restarted. Because of this, warm runs will complete in a few ms versus a few seconds for larger cold runs.