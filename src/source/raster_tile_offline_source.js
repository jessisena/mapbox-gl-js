

const util = require('../util/util');
const ajax = require('../util/ajax');
const Evented = require('../util/evented');
const loadTileJSON = require('./load_tilejson');
const normalizeURL = require('../util/mapbox').normalizeTileURL;
const TileBounds = require('./tile_bounds');
const RasterTileSource = require('./raster_tile_source');


class RasterTileSourceOffline extends RasterTileSource {

    constructor(id, options, dispatcher, eventedParent) {
        super(id, options, dispatcher, eventedParent);
        this.id = id;
        this.dispatcher = dispatcher;
        this.setEventedParent(eventedParent);

        this.type = 'rasteroffline';
        this.minzoom = 0;
        this.maxzoom = 22;
        this.roundZoom = true;
        this.scheme = 'xyz';
        this.tileSize = 512;
        this.imageFormat = 'png';
        this._loaded = false;
        this._options = util.extend({}, options);
        util.extend(this, util.pick(options, ['scheme', 'tileSize', 'imageFormat']));

        this._transparentPngUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';

        if (window.sqlitePlugin) {

            this.db = window.sqlitePlugin.openDatabase(
                JSON.parse(options.tiles[0])
            , function() {

            }, function() {
                throw new Error('vector tile Offline sources not opened');
            });

        }else{
            throw new Error('vector tile Offline sources need cordova-sqlite-ext extended -----> https://github.com/jessisena/cordova-sqlite-ext');
        }
        
    }

    loadTile(tile, callback) {

        tile.request = this._getImage(tile.coord, done.bind(this));

        function done(err, img) {
            delete tile.request;

            if (tile.aborted) {
                this.state = 'unloaded';
                return callback(null);
            }

            if (err) {
                this.state = 'errored';
                return callback(err);
            }

            if (this.map._refreshExpiredTiles) tile.setExpiryData(img);
            delete img.cacheControl;
            delete img.expires;

            const gl = this.map.painter.gl;
            tile.texture = this.map.painter.getTileTexture(img.width);
            if (tile.texture) {
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
            } else {
                tile.texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                if (this.map.painter.extTextureFilterAnisotropic) {
                    gl.texParameterf(gl.TEXTURE_2D, this.map.painter.extTextureFilterAnisotropic.TEXTURE_MAX_ANISOTROPY_EXT, this.map.painter.extTextureFilterAnisotropicMax);
                }

                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                tile.texture.size = img.width;
            }
            gl.generateMipmap(gl.TEXTURE_2D);

            tile.state = 'loaded';

            callback(null);
        }
    }

    _getBlob(coord, callback){

        const coordY = Math.pow(2, coord.z) -1 - coord.y;
        console.log(coordY);

        const query = 'SELECT tile_data as myTile FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?';
        const params = [coord.z, coord.x, coordY];

        const base64Prefix = 'data:image/' + this.imageFormat + ';base64,';


        this.db.executeSql(query, params, 
            function (res) {
                if(res.rows.length > 0) {

                    callback(undefined,
                        {
                            data: base64Prefix + res.rows.item(0).myTile,
                            cacheControl: null,
                            expires: null
                        });

                }else{
                    callback(undefined,
                        {
                            data: this._transparentPngUrl,
                            cacheControl: null,
                            expires: null
                        });
                }

            }, function (error) {
                callback("ERROR", null);
            }
        );        

    }


    _getImage(coord, callback) {

        return this._getBlob(coord, (err, imgData) => {            
            if (err) return callback(err);

            const img = new window.Image();
            const URL = window.URL || window.webkitURL;
            img.onload = () => {
                callback(null, img);
                URL.revokeObjectURL(img.src);
            };
            img.cacheControl = imgData.cacheControl;
            img.expires = imgData.expires;
            img.src = imgData.data;
        });        

    }
}

module.exports = RasterTileSourceOffline;
