// Fictional, local-only People fixtures. Never run against a hosted app.
const base=process.argv[2]||'http://127.0.0.1:4319';
const url=new URL(base);
if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw new Error('The demo seeder only accepts a local HTTP server.');
const fixtures=[
 ['demo-sara-nilsson','Sara Nilsson',41.3275,19.8187,'Coffee by the square—come join us!'],
 ['demo-johan-lind','Johan Lind',41.3235,19.8151,'Taking a walk. Back for dinner.'],
 ['demo-emma-svensson','Emma Svensson',41.3210,19.8215,'Found a sunny terrace.'],
 ['demo-markus-karlsson','Markus Karlsson',41.3320,19.8160,'Meet you at the square.']
];
for(const [who,name,lat,lng,message] of fixtures){
 const call=async(route,data)=>{const r=await fetch(base+route,{method:'PUT',headers:{origin:base,'content-type':'application/json','x-visitor-id':who},body:JSON.stringify(data)});if(!r.ok)throw new Error(await r.text());return r.json();};
 await call('/api/profile',{name});await call('/api/check-in',{lat,lng,message});
}
const r=await fetch(base+'/api/location-requests',{method:'POST',headers:{origin:base,'content-type':'application/json','x-visitor-id':'demo-sara-nilsson'},body:JSON.stringify({message:'Meeting at the restaurant in 15 minutes.'})});
if(!r.ok&&r.status!==429)throw new Error(await r.text());
console.log('Four fictional colleagues and a location request are ready at '+base+'/#map');
