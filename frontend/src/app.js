const express = require( 'express' );
let app = express();
const path = require( 'path' );
const cors = require( 'cors' );
const fs = require( 'fs' );
const bodyParser = require( 'body-parser' );
const dialog = require( 'electron' ).dialog;
const session = require( 'express-session' );
const indexer = require( './indexer.js' );
const axios = require( 'axios' );
const ip = require( 'ip' );
const jwt = require( 'jsonwebtoken' );
const shell = require( 'electron' ).shell;
const beautify = require( 'json-beautify' );
const EventSource = require( 'eventsource' );


app.use( bodyParser.urlencoded( { extended: false } ) );
app.use( bodyParser.json() );
app.use( cors() );
app.use( session( {
    secret: 'aeogetwöfaöow0ofö034eö8ptqw39eöavfui786uqew9t0ez9eauigwöfqewoöaiq938w0c8p9awöäf9¨äüöe',
    saveUninitialized: true,
    resave: false,
} ) );

const conf = JSON.parse( fs.readFileSync( path.join( __dirname + '/config/config.json' ) ) );

// TODO: Import from config
const remoteURL = conf.connectionURL ?? 'http://localhost:3000';
let hasConnected = false;

const connect = () => {
    if ( authKey !== '' && conf.doConnect ) {
        axios.post( remoteURL + '/connect', { 'authKey': authKey } ).then( res => {
            if ( res.status === 200 ) {
                console.log( '[ BACKEND INTEGRATION ] Connection successful' );
                hasConnected = true;
            } else {
                console.error( '[ BACKEND INTEGRATION ] Connection error occurred' );
            }
        } ).catch( err => {
            console.error( err );
        } );
        connectToSSESource();
        return 'connecting';
    } else {
        return 'noAuthKey';
    }
};

let isSSEAuth = false;
let sessionToken = '';
let errorCount = 0;
let isReconnecting = false;

const connectToSSESource = () => {
    if ( isSSEAuth ) {
        let source = new EventSource( remoteURL + '/mainNotifier', { 
            https: true, 
            withCredentials: true,
            headers: {
                'Cookie': sessionToken
            }
        } );
        source.onmessage = ( e ) => {
            let data;
            try {
                data = JSON.parse( e.data );
            } catch ( err ) {
                data = { 'type': e.data };
            }
            if ( data.type === 'blur' ) {
                sendClientUpdate( data.type, data.ip );
            } else if ( data.type === 'visibility' ) {
                sendClientUpdate( data.type, data.ip );
            }
        };

        source.onopen = () => {
            isReconnecting = false;
            console.log( '[ BACKEND INTEGRATION ] Connection to notifier successful' );
        };
            
        source.addEventListener( 'error', function( e ) {
            if ( e.eventPhase == EventSource.CLOSED ) source.close();

            setTimeout( () => {
                if ( !isReconnecting ) {
                    isReconnecting = true;
                    console.log( '[ BACKEND INTEGRATION ] Disconnected from notifier, reconnecting...' );
                    tryReconnect();
                }
            }, 1000 );
        }, false );
    } else {
        axios.post( remoteURL + '/authSSE', { 'authKey': authKey } ).then( res => {
            if ( res.status == 200 ) {
                sessionToken = res.headers[ 'set-cookie' ][ 0 ].slice( 0, res.headers[ 'set-cookie' ][ 0 ].indexOf( ';' ) );
                isSSEAuth = true;
                connectToSSESource();
            } else {
                connectToSSESource();
            }
        } );
    }
}

const tryReconnect = () => {
    const int = setInterval( () => {
        if ( !isReconnecting ) {
            clearInterval( int );
        } else {
            if ( errorCount > 5 ) {
                isSSEAuth = false;
                errorCount = 0;
            } else {
                errorCount += 1;
            }
            connectToSSESource();
        }
    }, 1000 );
}

let authKey = conf.authKey ?? '';

connect();


let connectedClients = {};
let changedStatus = [];

let currentDetails = {
    'songQueue': [],
    'playingSong': {},
    'pos': 0,
    'isPlaying': false,
    'queuePos': 0,
};

let connectedMain = {};
// TODO: Add backend integration

require( './appleMusicRoutes.js' )( app );

app.get( '/', ( request, response ) => {
    response.sendFile( path.join( __dirname + '/client/showcase.html' ) );
} );

app.get( '/getLocalIP', ( req, res ) => {
    res.send( ip.address() );
} );

app.get( '/useAppleMusic', ( req, res ) => {
    shell.openExternal( 'http://localhost:8081/apple-music' );
    res.send( 'ok' );
} );

app.get( '/openSongs', ( req, res ) => {
    // res.send( '{ "data": [ "/home/janis/Music/KB2022" ] }' );
    // res.send( '{ "data": [ "/mnt/storage/SORTED/Music/audio/KB2022" ] }' );
    res.send( { 'data': dialog.showOpenDialogSync( { properties: [ 'openDirectory' ], title: 'Open music library folder' } ) } );
} );

app.get( '/showcase.js', ( req, res ) => {
    res.sendFile( path.join( __dirname + '/client/showcase.js' ) );
} );

app.get( '/showcase.css', ( req, res ) => {
    res.sendFile( path.join( __dirname + '/client/showcase.css' ) );
} );

app.get( '/backgroundAnim.css', ( req, res ) => {
    res.sendFile( path.join( __dirname + '/client/backgroundAnim.css' ) );
} );

app.get( '/clientDisplayNotifier', ( req, res ) => {
    res.writeHead( 200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    } );
    res.status( 200 );
    res.flushHeaders();
    let det = { 'type': 'basics', 'data': currentDetails };
    res.write( `data: ${ JSON.stringify( det ) }\n\n` );
    connectedClients[ req.session.id ] = res;
    req.on( 'close', () => {
        connectedClients.splice( Object.keys( connectedClients ).indexOf( req.session.id ), 1 );
    } );
} );

app.get( '/mainNotifier', ( req, res ) => {
    const ipRetrieved = req.headers[ 'x-forwarded-for' ];
    const ip = ipRetrieved ? ipRetrieved.split( /, / )[ 0 ] : req.connection.remoteAddress;
    if ( ip === '::ffff:127.0.0.1' || ip === '::1' ) {
        res.writeHead( 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        } );
        res.status( 200 );
        res.flushHeaders();
        let det = { 'type': 'basics' };
        res.write( `data: ${ JSON.stringify( det ) }\n\n` );
        connectedMain = res;
    } else {
        res.send( 'wrong' );
    }
} );

const sendUpdate = ( update ) => {
    if ( update === 'pos' ) {
        currentDetails[ 'playingSong' ][ 'startTime' ] = new Date().getTime();
        for ( let client in connectedClients ) {
            connectedClients[ client ].write( 'data: ' + JSON.stringify( { 'type': 'playingSong', 'data': currentDetails[ 'playingSong' ] } ) + '\n\n' );
            connectedClients[ client ].write( 'data: ' + JSON.stringify( { 'type': 'pos', 'data': currentDetails[ 'pos' ] } ) + '\n\n' );
        }
    } else if ( update === 'playingSong' ) {
        if ( !currentDetails[ 'playingSong' ] ) {
            currentDetails[ 'playingSong' ] = {};
        }
        currentDetails[ 'playingSong' ][ 'startTime' ] = new Date().getTime();
        for ( let client in connectedClients ) {
            connectedClients[ client ].write( 'data: ' + JSON.stringify( { 'type': 'pos', 'data': currentDetails[ 'pos' ] } ) + '\n\n' );
        }
    } else if ( update === 'isPlaying' ) {
        currentDetails[ 'playingSong' ][ 'startTime' ] = new Date().getTime();
        for ( let client in connectedClients ) {
            connectedClients[ client ].write( 'data: ' + JSON.stringify( { 'type': 'playingSong', 'data': currentDetails[ 'playingSong' ] } ) + '\n\n' );
            connectedClients[ client ].write( 'data: ' + JSON.stringify( { 'type': 'pos', 'data': currentDetails[ 'pos' ] } ) + '\n\n' );
        }
    }

    for ( let client in connectedClients ) {
        connectedClients[ client ].write( 'data: ' + JSON.stringify( { 'type': update, 'data': currentDetails[ update ] } ) + '\n\n' );
    }
    
    // Check if connected and if not, try to authenticate with data from authKey file

    if ( hasConnected ) {
        if ( update === 'isPlaying' ) {
            axios.post( remoteURL + '/statusUpdate', { 'type': 'playingSong', 'data': currentDetails[ 'playingSong' ], 'authKey': authKey } ).catch( err => {
                console.error( err );
            } );

            axios.post( remoteURL + '/statusUpdate', { 'type': 'pos', 'data': currentDetails[ 'pos' ], 'authKey': authKey } ).catch( err => {
                console.error( err );
            } );
        } else if ( update === 'pos' ) {
            axios.post( remoteURL + '/statusUpdate', { 'type': 'playingSong', 'data': currentDetails[ 'playingSong' ], 'authKey': authKey } ).catch( err => {
                console.error( err );
            } );

            axios.post( remoteURL + '/statusUpdate', { 'type': 'pos', 'data': currentDetails[ 'pos' ], 'authKey': authKey } ).catch( err => {
                console.error( err );
            } );
        }
        axios.post( remoteURL + '/statusUpdate', { 'type': update, 'data': currentDetails[ update ], 'authKey': authKey } ).catch( err => {
            console.error( err );
        } );
    } else {
        connect();
    }
}

const allowedTypes = [ 'playingSong', 'isPlaying', 'songQueue', 'pos', 'queuePos' ];
app.post( '/statusUpdate', ( req, res ) => {
    if ( allowedTypes.includes( req.body.type ) ) {
        currentDetails[ req.body.type ] = req.body.data;
        changedStatus.push( req.body.type );
        sendUpdate( req.body.type );
        res.send( 'ok' );
    } else {
        res.status( 400 ).send( 'ERR_UNKNOWN_TYPE' );
    }
} );

// STATUS UPDATE from the client display to send to main ui
// Send update if page is closed
const allowedMainUpdates = [ 'blur', 'visibility' ];
app.post( '/clientStatusUpdate', ( req, res ) => {
    if ( allowedMainUpdates.includes( req.body.type ) ) {
        const ipRetrieved = req.headers[ 'x-forwarded-for' ];
        const ip = ipRetrieved ? ipRetrieved.split( /, / )[ 0 ] : req.connection.remoteAddress;
        sendClientUpdate( req.body.type, ip );
        res.send( 'ok' );
    } else {
        res.status( 400 ).send( 'ERR_UNKNOWN_TYPE' );
    }
} );

const sendClientUpdate = ( update, ip ) => {
    try {
        connectedMain.write( 'data: ' + JSON.stringify( { 'type': update, 'ip': ip } ) + '\n\n' );
    } catch ( err ) {}
}

app.get( '/indexDirs', ( req, res ) => {
    if ( req.query.dir ) {
        indexer.index( req ).then( dirIndex => {
            res.send( dirIndex );
        } ).catch( err => {
            if ( err === 'ERR_DIR_NOT_FOUND' ) {
                res.status( 404 ).send( 'ERR_DIR_NOT_FOUND' );
            } else {
                res.status( 500 ).send( 'unable to process' );
            }
        } );
    } else {
        res.status( 400 ).send( 'ERR_REQ_INCOMPLETE' );
    }
} );

app.get( '/loadPlaylist', ( req, res ) => {
    const selFile = dialog.showOpenDialogSync( { properties: [ 'openFile' ], title: 'Open file with playlist' } )[ 0 ];
    res.send( { 'data': JSON.parse( fs.readFileSync( selFile ) ), 'path': selFile } );
} );

app.get( '/getMetadata', async ( req, res ) => {
    res.send( await indexer.analyzeFile( req.query.file ) );
} );

app.post( '/savePlaylist', ( req, res ) => {
    fs.writeFileSync( dialog.showSaveDialogSync( { 
        properties: [ 'createDirectory' ], 
        title: 'Save the playlist as a json file', 
        filters: [
            {
                extensions: [ 'json' ],
                name: 'JSON files',
            }
        ],
        defaultPath: 'songs.json'
    } ), beautify( req.body, null, 2, 50 ) );
    res.send( 'ok' );
} );

app.get( '/getSongCover', ( req, res ) => {
    if ( req.query.filename ) {
        if ( indexer.getImages( req.query.filename ) ) {
            res.send( indexer.getImages( req.query.filename ) );
        } else {
            res.status( 404 ).send( 'No cover image for this file' );
        }
    } else {
        res.status( 400 ).send( 'ERR_REQ_INCOMPLETE' );
    }
} );

app.get( '/getSongFile', ( req, res ) => {
    if ( req.query.filename ) {
        res.sendFile( req.query.filename );
    } else {
        res.status( 400 ).send( 'ERR_REQ_INCOMPLETE' );
    }
} );


app.get( '/getAppleMusicDevToken', ( req, res ) => {
    // sign dev token
    const privateKey = fs.readFileSync( path.join( __dirname + '/config/apple_private_key.p8' ) ).toString();
    // TODO: Remove secret
    const config = JSON.parse( fs.readFileSync( path.join( __dirname + '/config/apple-music-api.config.json' ) ) );
    const jwtToken = jwt.sign( {}, privateKey, {
        algorithm: "ES256",
        expiresIn: "180d",
        issuer: config.teamID,
        header: {
            alg: "ES256",
            kid: config.keyID
        }
    } );
    res.send( jwtToken );
} );


app.use( ( request, response, next ) => {
    response.sendFile( path.join( __dirname + '' ) ) 
} );

app.listen( 8081 );