
import {reqStat} from "./types.ts";
import {handleMcRequest, status, handleGithubWebhook, onStart} from "./api_functions.ts";

const servePort: number = 3000;
const servIP: string = "0.0.0.0";
onStart();

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
                return new Response("Release candidate 1.4",                    {status: 200});
            default:
                return new Response("Unknown get route",                        {status: 501});
        }
    } else {
        return new Response("Reqest type not accepted", {status: 405});
    }
});
