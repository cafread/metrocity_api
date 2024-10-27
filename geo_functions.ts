import {compressionDebug, colorToId, openBorders} from './lookups.ts';
import {xy, res, latLon} from "./types.ts";

export function mercator (loc: latLon): xy {
    const mapDim: number = 32768; // 256 pixels * 128 tiles
    if (Math.abs(loc.lat) > 85.0511287798066) return [NaN, NaN]; // Assert latitude limits
    loc.lon = (loc.lon % 360 + 540) % 360 - 180; // Handle longitude rollover
    const latRad = loc.lat * Math.PI / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const x = (loc.lon + 180) * (mapDim / 360);
    const y = (mapDim / 2) - (mapDim * mercN / (2 * Math.PI));
    return [x, y];
}

export function genTileKey (prj: xy): string {
    return prj.map(n => lpad(Math.floor(n / 256).toString(), 3, "0")).join("_");
}

export function rgbToId ([r, g, b]: Uint8ClampedArray, nolog=false) {
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

export function makeUrl (tileKey: string): string {
    return 'https://cafread.github.io/metrocity2024/tiles/' + tileKey + '.png';
}

export function validateBorder (cc: string, mc_cc: string, res: res): res {
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

function lpad (str: string, len: number, padChar: string="0"): string {
    const retLen = Math.max(str.length, len);
    return padChar.repeat(retLen - str.length) + str;
}