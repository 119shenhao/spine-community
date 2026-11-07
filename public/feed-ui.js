// Home is a discussion feed; search tools and filters live only on /search.
export function feedParams(params,isSearch){
 const query=new URLSearchParams(params);
 if(!isSearch&&!query.has('sort'))query.set('sort','latest');
 return query;
}
export function sortRoute(path,params,sort){
 const query=new URLSearchParams(params);
 query.set('sort',sort);
 return (path==='/search'?'/search':'/')+'?'+query.toString();
}
