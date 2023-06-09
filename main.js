const { app, BrowserWindow } = require( 'electron' )
require( './app.js' );

const createWindow = () => {
    const win = new BrowserWindow( {
        width: 800,
        height: 600,
    })

    win.loadFile( './frontend/dist/index.html' );
};

app.whenReady().then( () => {
    createWindow();
    
    app.on( 'activate', () => {
        if ( BrowserWindow.getAllWindows().length === 0 ) { createWindow() };
    } );
} );

app.on( 'window-all-closed', () => {
    if ( process.platform !== 'darwin' ) { app.quit() };
} );