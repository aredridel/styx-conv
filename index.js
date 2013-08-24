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
    out.size = pbit32();
    var type = pbit8();
    if (types[type]) {
        out.type = types[type];
    } else {
        out.type = type;
    }
    out.tag = pbit16();
    switch (out.type) {
    case 'Tversion':
    case 'Rversion':
        out.msize = pbit32();
        out.version = pstring();
        break;
    case 'Tattach':
        out.fid = pbit32();
        out.afid = pbit32();
        out.uname = pstring();
        out.aname = pstring();
        break;
    case 'Rattach':
        out.qid = pqid();
        break;
    case 'Tauth':
        out.afid = pbit32();
        out.uname = pstring();
        out.aname = pstring();
        break;
    case 'Rauth':
        out.aqid = pqid();
        break;
    case 'Twalk':
        out.fid = pbit32();
        out.newfid = pbit32();
        out.nwname = pbit16();
        out.wname = [];
        for (var i = 0; i < out.nwname; i++) {
            out.wname.push(pstring());
        }
        break;
    case 'Rwalk':
        var nwqid = pbit16();
        out.wqid = [];
        for (var i = 0; i < nwqid; i++) {
            out.wqid.push(pqid());
        }
        break;
    case 'Topen':
        out.fid = pbit32();
        out.mode = pbit8();
        break;
    case 'Ropen':
        out.qid = pqid();
        out.iounit = pbit32();
        break;
    case 'Tstat':
        out.fid = pbit32();
        break;
    case 'Rstat':
        out.stat = pstat();
        break;
    case 'Tread':
        out.fid = pbit32();
        out.offset = pbit64();
        out.count = pbit32();
        break;
    case 'Rread':
        out.data = pbuffer(pbit32());
        break;
    }
    return out;

    function pbuffer(len) {
        var o = buffer.slice(offset, offset + len);
        offset += len;
        return o;
    }

    function pstring() {
        var length = pbit16();
        var o = buffer.slice(offset, offset + length).toString('utf8');
        offset += length;
        return o;
    }

    function pbit64() {
        var low = pbit32();
        var high = pbit32();
        return new Long(low, high, true);
    }

    function pbit32() {
        var b = buffer.readUInt32LE(offset);
        offset += 4;
        return b;
    }

    function pbit16() {
        var b = buffer.readUInt16LE(offset);
        offset += 2;
        return b;
    }

    function pbit8() {
        var b = buffer.readUInt8(offset);
        offset += 1;
        return b;
    }

    function pqid() {
        var out = {};
        out.type = pbit8();
        out.version = pbit32();
        out.path = pbit64();
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
    gbit32(0); // Save room for size.
    gbit8(typeof f.type == 'string' ? rtypes[f.type] : f.type);
    gbit16(f.tag);

    var startPos = pos;
    switch (f.type) {
    case 'Rversion':
        gbit32(msize);
        gstring(f.version);
        break;
    case 'Rauth':
        gqid(f.qid);
        break;
    case 'Rattach':
        gqid(f.qid);
        break;
    case 'Rwalk':
        gbit16(f.wqid ? f.wqid.length : 0);
        if (f.wqid) f.wqid.forEach(function(wqid) {
            gqid(wqid);
        });
        break;
    case 'Ropen':
        gqid(f.qid);
        gbit32(f.iounit)
        break;
    case 'Rstat':
        gbit16(0); // save room for size
        convM2D(f.stat);
        out.writeUInt16LE(pos - startPos - 2, startPos);
        break;
    case 'Rread':
        gbit32(f.data.length);
        gbuffer(f.data);
        break;
    }

    out.writeUInt32LE(pos, 0);

    console.log(out.slice(0, pos));

    return out.slice(0, pos);

    function gbit64(n) {
        if (n instanceof Long) {
            gbit32(n.getLowBitsUnsigned());
            gbit32(n.getHighBitsUnsigned());
        } else {
            gbit32(n);
            gbit32(0);
        }
    }

    function gbit32(n) {
        out.writeUInt32LE(n || 0, pos);
        pos += 4;
    }

    function gbit16(n) {
        out.writeUInt16LE(n || 0, pos);
        pos += 2;
    }

    function gbit8(n) {
        out.writeUInt8(n || 0, pos);
        pos += 1;
    }

    function gbuffer(b) {
        b.copy(out);
        pos += b.length;
    }

    function gstring(s) {
        var l = Buffer.byteLength(s, 'utf8');
        gbit16(l);
        out.write(s, pos, 'utf8');
        pos += l;

    }

    function gqid(q) {
        gbit8(q.type);
        gbit32(q.version);
        gbit64(q.path);
    }

    function convM2D(d) {
        gbit16(0); // save room for size
        var sizePos = pos;
        gbit16(d.type || 0);
        gbit32(d.dev || 0);
        gqid(d.qid);
        gbit32(d.mode);
        gbit32(d.atime);
        gbit32(d.mtime);
        gbit64(d.size);
        gstring(d.name);
        gstring(d.uid);
        gstring(d.gid);
        gstring(d.muid);

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
