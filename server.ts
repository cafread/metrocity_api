
import {resArr, resArrArr, retObj, reqStat} from "./types.ts";
import {testData, cache50} from "./lookups.ts";
import {resFmt, prepData, readTile, countCache, status, handleGithubWebhook} from "./functions.ts";

const servePort: number = 3000;
const servIP: string = "0.0.0.0";

Deno.serve({port: servePort, hostname: servIP}, async (request: Request) => {
    const ip: string = request.headers.get("host") || "";
    const pathName = new URL(request.url).pathname;
    const thisReq: reqStat = {
        "ip": ip,
        "begTs": (new Date()).getTime(),
        "reqType": request.method,
        "endPoint": pathName,
        "endTs": (new Date()).getTime(),
        "reqCount": 0
    };
    if (request.method == "POST") {
        if (pathName !== "/mc_api") return new Response("Unknown route", {status: 501});
        const inpData: JSON = await request.json();
        // Assert that the request payload is appropriate
        if (!Array.isArray(inpData))                                                       return new Response("Request is not array",   {status: 501});
        if (!inpData.every(x => typeof x === "object" && !Array.isArray(x) && x !== null)) return new Response("Invalid request data",   {status: 501});
        if (!inpData.every(e => e.id && e.lat && e.lon && Object.keys(e).length <= 4))     return new Response("Invalid request data",   {status: 501});
        if (!inpData.every(e => Math.abs(e.lat) <= 85.0511287798066))                      return new Response("Out of bounds latitude", {status: 501});
        // Assert that id is unique
        if (inpData.length > (new Set(inpData.map(l => l.id))).size)                       return new Response("Element ids not unique", {status: 501});
        thisReq.reqCount = inpData.length;
        // If there are no requests passed, run test data
        const toRead = inpData.length > 0 ? prepData(inpData) : prepData(testData);
        // Wait for all results, as the read function is per tile
        const readPromises: Promise<resArr>[] = [];
        for (const tileKey of Object.keys(toRead)) readPromises.push(readTile(tileKey, toRead[tileKey]));
        // Read and cache the tile data then calculate, format & return results
        let result: retObj = {};
        await Promise.all(readPromises).then((values: resArrArr) => result = resFmt(values));
        thisReq.endTs = (new Date()).getTime();
        console.log(thisReq);
        return new Response(JSON.stringify(result), {"status": 200, headers: {"content-type": "application/json"}});
    } else if (request.method === "GET") {
        console.log(thisReq);
        if (pathName === "/cache")    return new Response(countCache(),                               {status: 200});
        if (pathName === "/status")   return new Response(status(),                                   {status: 200});
        if (pathName === "/info")     return new Response("https://github.com/cafread/metrocity_api", {status: 200});
        if (pathName === "/version")  return new Response("Release candidate 1.1",                    {status: 200});
        return new Response("Unknown route", {status: 501});
    } else if (request.method === "POST" && pathName === "/github-webhook") {
        return handleGithubWebhook(request);
    } else {
        console.log(thisReq);
        return new Response("Reqest type not accepted", {status: 501});
    }
});
// On server start, cache data for the top 50 tiles to help make common responses faster
for (const tileKey of cache50) readTile(tileKey, []);
