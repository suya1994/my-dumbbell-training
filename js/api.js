/* ================================
   基础请求
================================ */

async function supabaseRequest(
path,
options={}
){

const response =
await fetch(

SUPABASE_URL +
"/rest/v1/" +
path,

{

method:
options.method || "GET",

headers:{

"apikey":
SUPABASE_KEY,

"Authorization":
"Bearer " +
SUPABASE_KEY,

"Content-Type":
"application/json",

"Prefer":
options.prefer ||
"return=representation"

},

body:
options.body
?
JSON.stringify(options.body)
:
undefined

}

);


if(!response.ok){

const text =
await response.text();

throw new Error(
"HTTP " +
response.status +
"：" +
text
);

}


const text =
await response.text();


return text
?
JSON.parse(text)
:
[];

}
