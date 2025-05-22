import {tileCache, result, retObj} from "./types.ts";
import {encodeBase64, decodeBase64} from "jsr:@std/encoding/base64";
import {compress, decompress} from "./lzstring.ts";
import {compressionDebug} from './lookups.ts';

const colorToId: {[index: string]: number} = await loadRemoteJSON("https://raw.githubusercontent.com/cafread/metrocity2024/main/res/colorToId.json");

export async function loadRemoteJSON<T> (url: string): Promise<T> {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch JSON: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(`Error fetching JSON from ${url}:`, error);
        throw error; // Rethrow error so callers can handle it
    }
}

export function leftPad (str: string, len: number, padChar: string="0"): string {
    const retLen = Math.max(str.length, len);
    return padChar.repeat(retLen - str.length) + str;
}

export function isValidTileKey (str: string): boolean {
    const regex = /^[0-9]{3}_[0-9]{3}$/;
    return regex.test(str);
}

export function encodeTile (tileData: Uint8ClampedArray): tileCache {
    const tempArr = [];
    const ids: number[] = [0]; // 0 = no metro city
    for (let i = 0; i < 256*256*4; i+=4) {
        const mcid = rgbToId(tileData.slice(i, i + 3));
        let _id = ids.indexOf(mcid);
        if (_id === -1) {
            _id = ids.length;
            ids.push(mcid);
        }
        tempArr.push(_id);
    }
    const datStr = compress(encodeBase64(new Uint8Array(tempArr)));
    return {idMap: ids, datStr: datStr};
}

export function decodeTile (tileCache: tileCache): number[] {
    // Turn a tilecache data structure into a 256*256 long array of mcids
    const codedMcs: Uint8Array = decodeBase64(decompress(tileCache.datStr));
    return Array.from(codedMcs).map(i => tileCache.idMap[i]);
}

export function rgbToId ([r, g, b]: Uint8ClampedArray) {
    if ([r, g, b].join("") === "000") return 0;
    if ([r, g, b].join("") === "255255255") return 0;
    let code = "rgba(" + r + "," + g + "," + b + ",1)";
    if (colorToId[code]) return colorToId[code];
    // Should be vestigial and never run, but dealt with an old bug in browser many years ago
    // Handles the case where a colour is read, but the value is off by one for some reason
    for (const per of compressionDebug) {
        code = "rgba(" + (r + per.r) + "," + (g + per.g) + "," + (b + per.b) + ",1)";
        if (colorToId[code]) return colorToId[code];
    }
    console.log("Sample not matched", [r, g, b]);
    return 0;
}

export function makeUrl (tileKey: string): string {
    return 'https://cafread.github.io/metrocity2024/tiles/' + tileKey + '.png';
}

export function formatResult (arr: result[][]): retObj {
    const result: retObj = {};
    for (const rA of arr) for (const r of rA) result[r.id] = r.mc;
    return result;
}
