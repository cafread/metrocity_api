
import {reqStat} from "./types.ts";
import {handleMcRequest, status, handleGithubWebhook, readTile} from "./functions.ts";
import {mastTileKeys} from "./lookups.ts"

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

// Cache the data so that subsequent requests are fast
async function buildCacheWithDelay(tileKeys: string[]) {
    let index = 0;
    const intervalId = setInterval(async () => {
        if (index >= tileKeys.length) {
            clearInterval(intervalId); // Stop once all tiles are processed
            console.log("All tiles have been processed.");
            return;
        }
        const tileKey = tileKeys[index];
        try {
            await readTile(tileKey, []);
            console.log(`Processed tile: ${tileKey}`);
        } catch(error) {
            console.error(`Failed to process tile ${tileKey}:`, error);
        }
        index++;
    }, 400);  // Delay between calls
}

const kv = await Deno.openKv();
(async function listUncached() {
    const mastTileSet = new Set(mastTileKeys);
    const cacheStatus = Object.fromEntries(mastTileKeys.map(k => [k, 0]));
    try {
        for await (const entry of kv.list({prefix: ["tile"]})) {
            console.log("Entry key:", entry.key); // Log the entire entry key
            const key = entry.key[1].toString();
            console.log("Tile key:", key); // Log the tile key
            if (mastTileSet.has(key)) cacheStatus[key] = 1; // Mark present
        }
    } catch (error) {
        console.error("Error accessing Deno KV:", error);
    }
    const uncachedTiles = Object.entries(cacheStatus)
        .filter(([_k, v]) => v === 0)
        .map(([k, _v]) => k);
    console.log(uncachedTiles);
    buildCacheWithDelay(uncachedTiles);
})();
