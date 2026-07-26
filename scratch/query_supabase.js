const url = "https://ztozevcqkfrohgjmngcj.supabase.co/rest/v1/global_plans?select=id,name,plan_kind,is_hidden";
const anonKey = "sb_publishable_5XI7rHUasA9ssbnix_qEvQ_7K0GgeXG";

fetch(url, {
  headers: {
    "apikey": anonKey,
    "Authorization": "Bearer " + anonKey
  }
})
.then(res => res.json())
.then(data => {
  console.log("=== SUPABASE global_plans ===");
  console.log(JSON.stringify(data, null, 2));
})
.catch(err => console.error(err));
