/*
 *  Edge Gateway
 */

const express = require('express');

const app = express();

app.use(express.static( __dirname+'/public'));

app.get('/', (req:any, res:any)=>{
    return res.sendFile('index.html');
});

app.listen( 8080, ()=>{ console.log('Edge Gateway UI server running on port 8080')})