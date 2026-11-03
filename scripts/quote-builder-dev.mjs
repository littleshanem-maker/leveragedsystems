import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import handler from '../api/quote-builder.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.status=function(code){this.statusCode=code;return this;};
  res.json=function(value){this.setHeader('Content-Type','application/json');this.end(JSON.stringify(value));return this;};
  res.send=function(value){this.end(value);return this;};
  if(url.pathname==='/api/quote-builder')return handler(req,res);
  if(url.pathname==='/tools/quote-builder'){res.writeHead(302,{Location:'/tools/quote-builder/'});res.end();return;}
  let relative;
  try{relative=decodeURIComponent(url.pathname);}catch{res.status(400).send('Invalid URL');return;}
  if(relative==='/')relative='/index.html';
  if(relative==='/tools/quote-builder/')relative+='index.html';
  const filename=path.resolve(root,'.'+relative);
  const allowed=filename.startsWith(path.join(root,'tools/quote-builder/'))||filename.startsWith(path.join(root,'assets/quote-fonts/'))||filename===path.join(root,'index.html');
  if(!allowed){res.status(404).send('Not found');return;}
  try{
    const bytes=await readFile(filename);
    res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-cache');res.send(bytes);
  }catch{res.status(404).send('Not found');}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('Quote builder: http://127.0.0.1:4173/tools/quote-builder/'));
