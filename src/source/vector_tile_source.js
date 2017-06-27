// @flow

const Evented = require('../util/evented');
const util = require('../util/util');
const loadTileJSON = require('./load_tilejson');
const normalizeURL = require('../util/mapbox').normalizeTileURL;
const TileBounds = require('./tile_bounds');

import type {ISource} from './source';
import type TileCoord from './tile_coord';
import type Map from '../ui/map';
import type Dispatcher from '../util/dispatcher';
import type Tile from './tile';

class VectorTileSource extends Evented implements ISource {
    type: 'vector';
    id: string;
    minzoom: number;
    maxzoom: number;
    url: string;
    scheme: string;
    tileSize: number;

    _options: any;
    dispatcher: Dispatcher;
    map: Map;
    bounds: any;
    tiles: any;
    tileBounds: any;
    reparseOverscaled: boolean;
    isTileClipped: boolean;

    constructor(id: string, options: any, dispatcher: Dispatcher, eventedParent: Evented) {
        super();
        this.id = id;
        this.dispatcher = dispatcher;

        this.type = 'vector';
        this.minzoom = 0;
        this.maxzoom = 22;
        this.scheme = 'xyz';
        this.tileSize = 512;
        this.reparseOverscaled = true;
        this.isTileClipped = true;
        util.extend(this, util.pick(options, ['url', 'scheme', 'tileSize']));

        this._options = util.extend({ type: 'vector' }, options);

        if (this.tileSize !== 512) {
            throw new Error('vector tile sources must have a tileSize of 512');
        }

        this.setEventedParent(eventedParent);
    }

    load() {
        this.fire('dataloading', {dataType: 'source'});

        loadTileJSON(this._options, (err, tileJSON) => {
            if (err) {
                this.fire('error', err);
            } else if (tileJSON) {
                util.extend(this, tileJSON);
                this.setBounds(tileJSON.bounds);

                // `content` is included here to prevent a race condition where `Style#_updateSources` is called
                // before the TileJSON arrives. this makes sure the tiles needed are loaded once TileJSON arrives
                // ref: https://github.com/mapbox/mapbox-gl-js/pull/4347#discussion_r104418088
                this.fire('data', {dataType: 'source', sourceDataType: 'metadata'});
                this.fire('data', {dataType: 'source', sourceDataType: 'content'});
            }
        });
    }

    setBounds(bounds: any) {
        this.bounds = bounds;
        if (bounds) {
            this.tileBounds = new TileBounds(bounds, this.minzoom, this.maxzoom);
        }
    }

    hasTile(coord: TileCoord) {
        return !this.tileBounds || this.tileBounds.contains(coord, this.maxzoom);
    }

    onAdd(map: Map) {
        this.load();
        this.map = map;
    }

    serialize() {
        return util.extend({}, this._options);
    }

    loadTile(tile: Tile, callback: Function) {
        const overscaling = tile.coord.z > this.maxzoom ? Math.pow(2, tile.coord.z - this.maxzoom) : 1;
        const params = {
            url: normalizeURL(tile.coord.url(this.tiles, this.maxzoom, this.scheme), this.url),
            uid: tile.uid,
            coord: tile.coord,
            zoom: tile.coord.z,
            tileSize: this.tileSize * overscaling,
            type: this.type,
            source: this.id,
            overscaling: overscaling,
            angle: this.map.transform.angle,
            pitch: this.map.transform.pitch,
            cameraToCenterDistance: this.map.transform.cameraToCenterDistance,
            cameraToTileDistance: this.map.transform.cameraToTileDistance(tile),
            showCollisionBoxes: this.map.showCollisionBoxes
        };

        if (!tile.workerID || tile.state === 'expired') {
            tile.workerID = this.dispatcher.send('loadTile', params, done.bind(this));
        } else if (tile.state === 'loading') {
            // schedule tile reloading after it has been loaded
            tile.reloadCallback = callback;
        } else {
            this.dispatcher.send('reloadTile', params, done.bind(this), tile.workerID);
        }

        function done(err, data) {
            if (tile.aborted)
                return;

            if (err) {
                return callback(err);
            }

            if (this.map._refreshExpiredTiles) tile.setExpiryData(data);
            tile.loadVectorData(data, this.map.painter);

            if (tile.redoWhenDone) {
                tile.redoWhenDone = false;
                tile.redoPlacement(this);
            }

            callback(null);

            if (tile.reloadCallback) {
                this.loadTile(tile, tile.reloadCallback);
                tile.reloadCallback = null;
            }
        }
    }

    abortTile(tile: Tile) {
        this.dispatcher.send('abortTile', { uid: tile.uid, type: this.type, source: this.id }, null, tile.workerID);
    }

    unloadTile(tile: Tile) {
        tile.unloadVectorData();
        this.dispatcher.send('removeTile', { uid: tile.uid, type: this.type, source: this.id }, null, tile.workerID);
    }
}

module.exports = VectorTileSource;
