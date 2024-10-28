
import {reqStat} from "./types.ts";
import {handleMcRequest, status, handleGithubWebhook, readTile} from "./functions.ts";
import {cache50} from "./lookups.ts"

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
        switch (pathName) {
            case "/mc_api":
                return handleMcRequest (request, thisReq);
            case "/github-webhook":
                console.log(thisReq);
                return handleGithubWebhook(request);
            default:
                return new Response("Unknown post route", {status: 501});
        }
    } else if (request.method === "GET") {
        console.log(thisReq);
        switch (pathName) {
            // case "/cache": // Awaiting kv.count({prefix: ["tile"]}) to avoid large & pointless reads
            //     return new Response(`Cached ${await countCache()} tiles`,       {status: 200});
            case "/status":
                return new Response(status(),                                   {status: 200});
            case "/info":
                return new Response("https://github.com/cafread/metrocity_api", {status: 200});
            case "/version":
                return new Response("Release candidate 1.3",                    {status: 200});
            default:
                return new Response("Unknown get route",                        {status: 501});
        }
    } else {
        return new Response("Reqest type not accepted", {status: 501});
    }
});

// Cache the data for the top 50 tiles
// for (const tileKey of cache50) readTile(tileKey, []);

// Temp, rebuilding cache
const kv = await Deno.openKv();
(async function deleteAllTilesFromKv() {
    // List all entries with the prefix "tile"
    for await (const entry of kv.list({ prefix: ["tile"] })) {
        // Delete each entry by its key
        await kv.delete(entry.key);
    }
    console.log("All entries with prefix 'tile' have been deleted.");
    for (const tileKey of cache50) readTile(tileKey, []);
})();



