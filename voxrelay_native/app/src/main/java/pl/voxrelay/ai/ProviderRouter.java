package pl.voxrelay.ai;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class ProviderRouter {
    static final class Msg { final String role,text; Msg(String r,String t){role=r;text=t;} }
    static final class Reply { final String model,text; Reply(String m,String t){model=m;text=t;} }
    private static final Map<String,Long> cooldown=new HashMap<>();

    static Reply ask(List<Msg> history, SecureStore store) throws Exception {
        List<Attempt> chain=new ArrayList<>();
        String gemini=store.get("gemini"), groq=store.get("groq"), openrouter=store.get("openrouter");
        if(!gemini.isEmpty()) chain.add(new Attempt("Gemini 3.5 Flash",()->gemini(history,gemini)));
        if(!openrouter.isEmpty()) chain.add(new Attempt("Kimi K2.6 Free",()->openAi(history,"https://openrouter.ai/api/v1/chat/completions",openrouter,"moonshotai/kimi-k2.6:free",true)));
        if(!groq.isEmpty()) chain.add(new Attempt("Groq GPT-OSS 120B",()->openAi(history,"https://api.groq.com/openai/v1/chat/completions",groq,"openai/gpt-oss-120b",false)));
        if(!groq.isEmpty()) chain.add(new Attempt("Groq Qwen 3.6 27B",()->openAi(history,"https://api.groq.com/openai/v1/chat/completions",groq,"qwen/qwen3.6-27b",false)));
        if(!openrouter.isEmpty()) chain.add(new Attempt("OpenRouter Free",()->openAi(history,"https://openrouter.ai/api/v1/chat/completions",openrouter,"openrouter/free",true)));
        if(chain.isEmpty()) return new Reply("Setup","Dodaj przynajmniej jeden darmowy klucz API w ustawieniach: Gemini, Groq albo OpenRouter.");
        Exception last=null;
        for(Attempt a:chain){
            long until=cooldown.getOrDefault(a.name,0L); if(until>System.currentTimeMillis()) continue;
            try { String text=a.call.run(); if(text!=null&&!text.trim().isEmpty()) return new Reply(a.name,text.trim()); }
            catch(Exception e){ last=e; cooldown.put(a.name,System.currentTimeMillis()+60000L); }
        }
        throw new Exception(last==null?"Wszystkie modele są chwilowo niedostępne.":"Wszystkie modele odrzuciły żądanie: "+last.getMessage());
    }

    private static String gemini(List<Msg> h,String key) throws Exception {
        JSONArray contents=new JSONArray();
        for(Msg m:tail(h,12)){
            JSONObject item=new JSONObject(); item.put("role","assistant".equals(m.role)?"model":"user");
            item.put("parts",new JSONArray().put(new JSONObject().put("text",m.text))); contents.put(item);
        }
        JSONObject body=new JSONObject().put("contents",contents);
        String raw=post("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key="+key,null,body.toString());
        JSONObject j=new JSONObject(raw); return j.getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts").getJSONObject(0).getString("text");
    }

    private static String openAi(List<Msg> h,String url,String key,String model,boolean openRouter) throws Exception {
        JSONArray messages=new JSONArray();
        messages.put(new JSONObject().put("role","system").put("content","Jesteś rzeczowym polskojęzycznym asystentem głosowym. Odpowiadaj naturalnie, konkretnie i niezbyt długo, chyba że użytkownik prosi o szczegóły."));
        for(Msg m:tail(h,12)) messages.put(new JSONObject().put("role",m.role).put("content",m.text));
        JSONObject body=new JSONObject().put("model",model).put("messages",messages);
        Map<String,String> headers=new HashMap<>(); headers.put("Authorization","Bearer "+key);
        if(openRouter){ headers.put("X-Title","VoxRelay AI"); }
        String raw=post(url,headers,body.toString());
        JSONObject j=new JSONObject(raw); return j.getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content","");
    }

    private static List<Msg> tail(List<Msg> h,int n){ return h.subList(Math.max(0,h.size()-n),h.size()); }

    private static String post(String endpoint,Map<String,String> headers,String body) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(endpoint).openConnection(); c.setRequestMethod("POST"); c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setDoOutput(true); c.setRequestProperty("Content-Type","application/json");
        if(headers!=null) for(Map.Entry<String,String> e:headers.entrySet()) c.setRequestProperty(e.getKey(),e.getValue());
        try(OutputStream os=c.getOutputStream()){ os.write(body.getBytes(StandardCharsets.UTF_8)); }
        int code=c.getResponseCode(); InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();
        StringBuilder sb=new StringBuilder(); if(in!=null) try(BufferedReader br=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){ String line; while((line=br.readLine())!=null) sb.append(line); }
        if(code<200||code>=300) throw new Exception("HTTP "+code+" "+(sb.length()>180?sb.substring(0,180):sb.toString())); return sb.toString();
    }

    private interface Call { String run() throws Exception; }
    private static final class Attempt { final String name; final Call call; Attempt(String n,Call c){name=n;call=c;} }
}
