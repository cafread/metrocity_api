import {createCanvas, loadImage} from "https://deno.land/x/canvas@v1.4.2/mod.ts";
import {compressionDebug, colorToId, mastTileKeys, cityData, openBorders} from './lookups.ts';
import {xy, rawData, targ, targArr, res, resArr, resArrArr, latLon, retObj, reqStat} from "./types.ts";

// Use a cache as prime location tiles will be hit a lot
// This speeds up the response and reduces calls to Github
const cache: {[index: string]: Uint8ClampedArray} = {};
let servCount: number = 0;
let reqCount: number = 0;
const startTs: number = (new Date()).getTime() / 1000;

export async function readTile (tileKey: string, locations: targArr): Promise<resArr> {
    if (mastTileKeys.indexOf(tileKey) === -1) return locations.map(t => ({"id": t.id, "mc": ''}));
    let tileData: Uint8ClampedArray;
    // If available, read from cache
    if (cache[tileKey] !== undefined) {
        tileData = cache[tileKey];
    } else {
        const url = makeUrl(tileKey);
        const cvs = createCanvas(256, 256);
        const ctx = cvs.getContext("2d");
        const image = await loadImage(url);
        ctx.drawImage(image, 0, 0);
        tileData = ctx.getImageData(0, 0, 256, 256).data;
        cache[tileKey] = tileData;
    }
    return locations.map(loc => {
        const spl = (loc.y * 256 + loc.x) * 4; // Locate data
        const mcid = rgbToId(tileData.slice(spl, spl + 3)); // Read specified data & convert to id, no alpha
        const mcn = cityData[mcid] || ''; // Read name from lookup
        if (mcn    === '') return {"id": loc.id, "mc": mcn};
        if (loc.cc === '') return {"id": loc.id, "mc": mcn};
        return validateBorder(loc.cc, mcn.slice(-2), {"id": loc.id, "mc": mcn});
    });
}

export function prepData (rawData: rawData): {[index: string]: targArr} {
    // Project the lat long, calculate the tileKey
    // Return projected values grouped by tileKey
    const res: {[index: string]: targArr} = {};
    for (const d of rawData) {
        const p: xy = mercator({lat: d.lat, lon: d.lon});
        const tileKey: string = genTileKey(p);
        const x = Math.floor(p[0]) % 256;
        const y = Math.floor(p[1]) % 256;
        const cc: string = (d.cc || '').toUpperCase(); // cc is optional in request
        const thisTarg: targ = {id: d.id, x: x, y: y, cc: cc};
        if (res[tileKey]) {
            res[tileKey].push(thisTarg)
        } else {
            res[tileKey] = [thisTarg];
        }
    };
    return res;
}

export function resFmt (arr: resArrArr): retObj {
    const result: retObj = {};
    for (const rA of arr) for (const r of rA) result[r.id] = r.mc;
    servCount += Object.keys(result).length;
    reqCount++;
    return result;
}

export function countCache (): string {
    return "Cached " + Object.keys(cache).length.toString() + " of " + mastTileKeys.length + " tiles";
}

export function status (): string {
    const upTim = (new Date()).getTime() / 1000 - startTs;
    const upDay = (Math.floor((upTim / (60*60*24)))     ).toString();
    const upHrs = (Math.floor((upTim / (60*60   ))) % 24).toString();
    const upMin = (Math.floor((upTim / (60      ))) % 60).toString();
    const upSec = (Math.floor( upTim              ) % 60).toString();
    let msg  = 'Server has been up for ' + upDay + ' days, ';
        msg += upHrs + ' hours, ';
        msg += upMin + ' minutes, ';
        msg += upSec + ' seconds. ';
        msg += servCount.toString() + ' locations served via ';
        msg += reqCount.toString() + ' requests';
    return msg;
}

function mercator (loc: latLon): xy {
    const mapDim: number = 32768; // 256 pixels * 128 tiles
    if (Math.abs(loc.lat) > 85.0511287798066) return [NaN, NaN]; // Assert latitude limits
    loc.lon = (loc.lon % 360 + 540) % 360 - 180; // Handle longitude rollover
    const latRad = loc.lat * Math.PI / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const x = (loc.lon + 180) * (mapDim / 360);
    const y = (mapDim / 2) - (mapDim * mercN / (2 * Math.PI));
    return [x, y];
}

function genTileKey (prj: xy): string {
    return prj.map(n => lpad(Math.floor(n / 256).toString(), 3, "0")).join("_");
}

function rgbToId ([r, g, b]: Uint8ClampedArray, nolog=false) {
    if ([r, g, b].join("") === "000") return 0;
    if ([r, g, b].join("") === "255255255") return 0;
    let code = "rgba(" + r + "," + g + "," + b + ",1)";
    if (colorToId[code]) return colorToId[code];
    for (const per of compressionDebug) {
        code = "rgba(" + (r + per.r) + "," + (g + per.g) + "," + (b + per.b) + ",1)";
        if (colorToId[code]) return colorToId[code];
    }
    if (!nolog) console.log("Sample not matched", [r, g, b]);
    return 0;
}

function lpad (str: string, len: number, padChar: string="0"): string {
    const retLen = Math.max(str.length, len);
    return padChar.repeat(retLen - str.length) + str;
}

function makeUrl (tileKey: string): string {
    return 'https://cafread.github.io/metrocity2024/tiles/' + tileKey + '.png';
}

function validateBorder (cc: string, mc_cc: string, res: res): res {
    if (cc === 'SG') return {"id": res.id, "mc": 'Singapore, SG'};
    if (cc === 'HK') return {"id": res.id, "mc": 'Hong Kong, HK'};
    if (cc === 'MO') return {"id": res.id, "mc": 'Macau, (MO), CN'};
    if (cc === 'MY' && mc_cc === 'SG') return {"id": res.id, "mc": 'Johor Bahru, MY'};
    if (cc === mc_cc) return res;
    if (openBorders[cc]?.includes(mc_cc)) return res;
    // Special awkward border cases
    if (cc === 'CG' && res.mc === 'Kinshasa, CD') return {"id": res.id, "mc": 'Brazzaville, CG'};
    if (cc === 'MX' && res.mc === 'San Diego, (CA), US') return {"id": res.id, "mc": 'Tijuana, MX'};
    if (cc === 'US' && res.mc === 'Juarez, MX') return {"id": res.id, "mc": 'El Paso, (TX), US'};
    if (cc === 'US' && res.mc === 'Hamilton, (ON), CA') return {"id": res.id, "mc": 'Buffalo, (NY), US'};
    if (cc === 'US' && res.mc === 'Windsor, (ON), CA') return {"id": res.id, "mc": 'Detroit, (MI), US'};
    if (cc === 'US' && res.mc === 'London, (ON), CA') return {"id": res.id, "mc": 'Detroit, (MI), US'};
    if (cc === 'CA' && res.mc === 'Detroit, (MI), US') return {"id": res.id, "mc": 'Windsor, (ON), CA'};
    if (cc === 'CN' && res.mc === 'Hong Kong, HK') return {"id": res.id, "mc": 'Shenzhen, (GD), CN'};
    if (cc === 'TR' && res.mc === 'Nicosia, CY') return res;
    return {"id": res.id, mc: ''};
}