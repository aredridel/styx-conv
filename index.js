require('buffer').INSPECT_MAX_BYTES = 1000
var stream = require('stream');
var util = require('util');
var duplex = require('duplex-combination');

var Long = require('long');

var NOTAG = 0xFFFF;
var NOFID = 0xFFFFFFFF;
var NOUID = -1;
var IOHDRSIZE = 24;

var QTDIR    = 0x80 /* type bit for directories */
var QTAPPEND = 0x40 /* type bit for append only files */
var QTEXCL   = 0x20 /* type bit for exclusive use files */
var QTMOUNT  = 0x10 /* type bit for mounted channel */
var QTAUTH   = 0x08 /* type bit for authentication file */
var QTFILE   = 0x00 /* plain file */

var types = {
    /* 9P2000.u */
    98: 'Topenfd',
    99: 'Ropenfd',

    /* 9P2000 */
    100: 'Tversion',
    101: 'Rversion',
    102: 'Tauth',
    103: 'Rauth',
    104: 'Tattach',
    105: 'Rattach',
    106: 'Terror', /* illegal */
    107: 'Rerror',
    108: 'Tflush',
    109: 'Rflush',
    110: 'Twalk',
    111: 'Rwalk',
    112: 'Topen',
    113: 'Ropen',
    114: 'Tcreate',
    115: 'Rcreate',
    116: 'Tread',
    117: 'Rread',
    118: 'Twrite',
    119: 'Rwrite',
    120: 'Tclunk',
    121: 'Rclunk',
    122: 'Tremove',
    123: 'Rremove',
    124: 'Tstat',
    125: 'Rstat',
    126: 'Twstat',
    127: 'Rwstat',
    128: 'Tmax'
}

var rtypes = {};

for (var i in types) {
    rtypes[types[i]] = i;
}

function S2MStream(options) {
    if (!(this instanceof S2MStream)) return new S2MStream(options);
    if (!options) options = {};
    options.objectMode = true;

    stream.Transform.call(this, options);

    this._buffer = new Buffer(0);
}

util.inherits(S2MStream, stream.Transform);

S2MStream.prototype._transform = function(chunk, encoding, callback) {
    var packetLen;

    console.log(chunk);

    this._buffer = Buffer.concat([this._buffer, chunk]);

    while (this._buffer.length > 4 &&
        (packetLen = this._buffer.readUInt32LE(0)) <= this._buffer.length

    ) {
        this.push(convS2M(this._buffer));
        this._buffer = this._buffer.slice(packetLen);
    }

    callback();
}

function convS2M(buffer) {
    var out = {};

    var offset = 0;
    out.size = gbit32();
    var type = gbit8();
    if (types[type]) {
        out.type = types[type];
    } else {
        out.type = type;
    }
    out.tag = gbit16();
    switch (out.type) {
    case 'Tversion':
    case 'Rversion':
        out.msize = gbit32();
        out.version = gstring();
        break;
    case 'Tattach':
        out.fid = gbit32();
        out.afid = gbit32();
        out.uname = gstring();
        out.aname = gstring();
        break;
    case 'Rattach':
        out.qid = gqid();
        break;
    case 'Tauth':
        out.afid = gbit32();
        out.uname = gstring();
        out.aname = gstring();
        break;
    case 'Rauth':
        out.aqid = gqid();
        break;
    case 'Twalk':
        out.fid = gbit32();
        out.newfid = gbit32();
        out.nwname = gbit16();
        out.wname = [];
        for (var i = 0; i < out.nwname; i++) {
            out.wname.push(gstring());
        }
        break;
    case 'Rwalk':
        var nwqid = gbit16();
        out.wqid = [];
        for (var i = 0; i < nwqid; i++) {
            out.wqid.push(gqid());
        }
        break;
    case 'Topen':
        out.fid = gbit32();
        out.mode = gbit8();
        break;
    case 'Ropen':
        out.qid = gqid();
        out.iounit = gbit32();
        break;
    case 'Tstat':
        out.fid = gbit32();
        break;
    case 'Rstat':
        out.stat = pstat();
        break;
    case 'Tread':
        out.fid = gbit32();
        out.offset = gbit64();
        out.count = gbit32();
        break;
    case 'Rread':
        out.data = gbuffer(gbit32());
        break;
    }
    return out;

    function gbuffer(len) {
        var o = buffer.slice(offset, offset + len);
        offset += len;
        return o;
    }

    function gstring() {
        var length = gbit16();
        var o = buffer.slice(offset, offset + length).toString('utf8');
        offset += length;
        return o;
    }

    function gbit64() {
        var low = gbit32();
        var high = gbit32();
        return new Long(low, high, true);
    }

    function gbit32() {
        var b = buffer.readUInt32LE(offset);
        offset += 4;
        return b;
    }

    function gbit16() {
        var b = buffer.readUInt16LE(offset);
        offset += 2;
        return b;
    }

    function gbit8() {
        var b = buffer.readUInt8(offset);
        offset += 1;
        return b;
    }

    function gqid() {
        var out = {};
        out.type = gbit8();
        out.version = gbit32();
        out.path = gbit64();
        return out;
    }
}

function M2SStream(options) {
    if (!(this instanceof M2SStream)) return new M2SStream(options);
    if (!options) options = {};
    options.objectMode = true;

    stream.Transform.call(this, options);
}

util.inherits(M2SStream, stream.Transform);

M2SStream.prototype._transform = function(f, encoding, callback) {
    if (f.type == 'Rversion' || f.type == 'Tversion' || f.type == 100 || f.type == 101) {
        this._msize = f.msize;
    }

    this.push(convM2S(f, this._msize));

    callback();
};

function convM2S(f, msize) {
    var out = new Buffer(msize);
    var pos = 0;
    pbit32(0); // Save room for size.
    pbit8(typeof f.type == 'string' ? rtypes[f.type] : f.type);
    pbit16(f.tag);

    var startPos = pos;
    switch (f.type) {
    case 'Rversion':
        pbit32(msize);
        pstring(f.version);
        break;
    case 'Rauth':
        pqid(f.qid);
        break;
    case 'Rattach':
        pqid(f.qid);
        break;
    case 'Rwalk':
        pbit16(f.wqid ? f.wqid.length : 0);
        if (f.wqid) f.wqid.forEach(function(wqid) {
            pqid(wqid);
        });
        break;
    case 'Ropen':
        pqid(f.qid);
        pbit32(f.iounit)
        break;
    case 'Rstat':
        pbit16(0); // save room for size
        convM2D(f.stat);
        out.writeUInt16LE(pos - startPos - 2, startPos);
        break;
    case 'Rread':
        pbit32(f.data.length);
        pbuffer(f.data);
        break;
    }

    out.writeUInt32LE(pos, 0);

    console.log(out.slice(0, pos));

    return out.slice(0, pos);

    function pbit64(n) {
        if (n instanceof Long) {
            pbit32(n.getLowBitsUnsigned());
            pbit32(n.getHighBitsUnsigned());
        } else {
            pbit32(n);
            pbit32(0);
        }
    }

    function pbit32(n) {
        out.writeUInt32LE(n || 0, pos);
        pos += 4;
    }

    function pbit16(n) {
        out.writeUInt16LE(n || 0, pos);
        pos += 2;
    }

    function pbit8(n) {
        out.writeUInt8(n || 0, pos);
        pos += 1;
    }

    function pbuffer(b) {
        b.copy(out);
        pos += b.length;
    }

    function pstring(s) {
        var l = Buffer.byteLength(s, 'utf8');
        pbit16(l);
        out.write(s, pos, 'utf8');
        pos += l;

    }

    function pqid(q) {
        pbit8(q.type);
        pbit32(q.version);
        pbit64(q.path);
    }

    function convM2D(d) {
        pbit16(0); // save room for size
        var sizePos = pos;
        pbit16(d.type || 0);
        pbit32(d.dev || 0);
        pqid(d.qid);
        pbit32(d.mode);
        pbit32(d.atime);
        pbit32(d.mtime);
        pbit64(d.size);
        pstring(d.name);
        pstring(d.uid);
        pstring(d.gid);
        pstring(d.muid);

        out.writeUInt16LE(pos - sizePos, sizePos);
    }
}

exports.S2MStream = S2MStream;
exports.M2SStream = M2SStream;

exports.wrapStream = function wrapStream(stream) {
    var s2m = new S2MStream();
    var m2s = new M2SStream();
    stream.pipe(s2m);
    m2s.pipe(stream);
    return duplex(s2m, m2s);
};
