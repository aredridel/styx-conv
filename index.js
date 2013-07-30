var stream = require('stream');
var util = require('util');
var duplex = require('duplex-combination');

var NOTAG = 0xFFFF;
var NOFID = 0xFFFFFFFF;
var NOUID = -1;
var IOHDRSIZE = 24;

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
        out.msize = pbit32();
        out.version = pstring();
        break;
    }
    return out;

    function pstring() {
        var length = pbit16();
        var o = buffer.slice(offset, offset + length).toString('utf8');
        offset += length;
        return o;
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
};

function convM2S(f, msize) {
    var out = new Buffer(msize);
    var pos = 0;
    gbit32(0); // Save room for size.
    gbit8(typeof f.type == 'string' ? rtypes[f.type] : f.type);
    gbit16(f.tag);

    switch (f.type) {
    case 'Rversion':
        gbit32(msize);
        gstring(f.version);
    }

    out.writeUInt32LE(pos, 0);

    console.log(out.slice(0, pos));

    return out.slice(0, pos);

    function gbit32(n) {
        out.writeUInt32LE(n, pos);
        pos += 4;
    }

    function gbit16(n) {
        out.writeUInt16LE(n, pos);
        pos += 2;
    }

    function gbit8(n) {
        out.writeUInt8(n, pos);
        pos += 1;
    }

    function gstring(s) {
        var l = Buffer.byteLength(s, 'utf8');
        gbit16(l);
        out.write(s, pos, 'utf8');
        pos += l;

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
