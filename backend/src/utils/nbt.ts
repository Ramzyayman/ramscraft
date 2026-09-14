import zlib from 'zlib';

/**
 * Minimal read-only decoder for Java Edition NBT (big-endian), e.g. player .dat
 * files. RamsCraft never writes NBT: the server owns those files. Longs become
 * Numbers (fine for timestamps), and byte/int/long arrays become number arrays.
 */
export function readNbt(file: Buffer): Record<string, any> {
    const data = file[0] === 0x1f && file[1] === 0x8b ? zlib.gunzipSync(file) : file;
    let o = 0;

    const str = () => {
        const n = data.readUInt16BE(o);
        o += 2 + n;
        return data.toString('utf8', o - n, o);
    };
    const list = (n: number, read: () => any) => Array.from({ length: n }, read);

    const payload = (type: number): any => {
        switch (type) {
            case 1: return data.readInt8(o++);
            case 2: o += 2; return data.readInt16BE(o - 2);
            case 3: o += 4; return data.readInt32BE(o - 4);
            case 4: o += 8; return Number(data.readBigInt64BE(o - 8));
            case 5: o += 4; return data.readFloatBE(o - 4);
            case 6: o += 8; return data.readDoubleBE(o - 8);
            case 7: { const n = data.readInt32BE(o); o += 4; return list(n, () => data.readInt8(o++)); }
            case 8: return str();
            case 9: {
                const itemType = data.readInt8(o);
                const n = data.readInt32BE(o + 1);
                o += 5;
                return list(n, () => payload(itemType));
            }
            case 10: {
                const out: Record<string, any> = {};
                let t: number;
                while ((t = data.readInt8(o++)) !== 0) {
                    const key = str();
                    out[key] = payload(t);
                }
                return out;
            }
            case 11: { const n = data.readInt32BE(o); o += 4; return list(n, () => payload(3)); }
            case 12: { const n = data.readInt32BE(o); o += 4; return list(n, () => payload(4)); }
            default: throw new Error(`Unsupported NBT tag type ${type}`);
        }
    };

    if (data.readInt8(o++) !== 10) throw new Error('NBT root is not a compound');
    str(); // root name (unused)
    return payload(10);
}
