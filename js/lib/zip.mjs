/**
 * The zip codec behind `geneseed backup` and `geneseed restore`.
 *
 * WHY HAND-WRITTEN. The CLI may not spawn (no `tar`, no `Expand-Archive`) and ships with zero
 * runtime dependencies, and a vendored zip library would carry far more than a backup needs.
 * The subset here is small: deflate or store, UTF-8 names, no zip64, no encryption (the user
 * decided a backup is a plain copy, 2026-11-23). `zlib.crc32` needs Node 22.2; the floor is 22.7.
 *
 * WHY THE READER TRUSTS ONLY THE CENTRAL DIRECTORY. Sizes in a local header may be zero (a
 * streamed writer) or forged; the central directory is the archive's own table of contents.
 *
 * WHY THE NAME CHECK IS HERE. A restore joins entry names onto the user's home. Refusing a name
 * at the one place an archive is decoded means no caller can forget to: a parent step, an
 * absolute path, a drive letter or a backslash never leaves this module.
 *
 * A fixed DOS time (1980-01-01) by default, so the same files always give the same bytes.
 */
import zlib from 'node:zlib';

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;
const UTF8_FLAG = 0x0800;
const DOS_DATE_1980 = (0 << 9) | (1 << 5) | 1;

/** Why `name` is unsafe to join onto a directory, or null when it is safe. */
function unsafeName(name) {
  if (!name) return 'empty';
  if (name.includes('\\')) return 'backslash';
  if (name.startsWith('/')) return 'absolute';
  if (/^[A-Za-z]:/.test(name)) return 'drive letter';
  if (name.split('/').some((s) => s === '..' || s === '.' || s === '')) return 'bad segment';
  return null;
}

function checkName(name) {
  const why = unsafeName(name);
  if (why) throw new Error(`unsafe entry name '${name}' (${why})`);
}

function dosTime(d) {
  if (!d) return { time: 0, date: DOS_DATE_1980 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * One zip archive holding `entries`, in their order.
 * @param {{ name: string, data: Buffer, mtime?: Date }[]} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  if (entries.length > MAX_ENTRIES) throw new Error(`too many entries (${entries.length}, max ${MAX_ENTRIES})`);
  const locals = []; const centrals = [];
  let offset = 0;
  for (const { name, data, mtime } of entries) {
    checkName(name);
    if (data.length >= MAX_SIZE) throw new Error(`entry too large for a zip without zip64: '${name}'`);
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const store = deflated.length >= data.length;
    const body = store ? data : deflated;
    const crc = zlib.crc32(data);
    const { time, date } = dosTime(mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + body.length;
    if (offset >= MAX_SIZE) throw new Error('archive too large for a zip without zip64');
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * The entries of a zip archive, in central-directory order. Throws on a name that is unsafe to
 * join onto a directory, a method other than store or deflate, or a CRC mismatch.
 * @param {Buffer} buf
 * @returns {{ name: string, data: Buffer }[]}
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') && usize === 0) continue;  // a directory entry another tool wrote
    checkName(name);
    if (buf.readUInt32LE(at) !== 0x04034b50) throw new Error(`corrupt local header for '${name}'`);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const body = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = zlib.inflateRawSync(body);
    else throw new Error(`unsupported compression method ${method} for '${name}'`);
    if (data.length !== usize || zlib.crc32(data) !== crc) throw new Error(`crc mismatch for '${name}'`);
    out.push({ name, data });
  }
  return out;
}
