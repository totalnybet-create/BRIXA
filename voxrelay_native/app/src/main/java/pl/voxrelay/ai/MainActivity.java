package pl.voxrelay.ai;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final ArrayList<ProviderRouter.Msg> history=new ArrayList<>();
    private TextView log,status; private Button mic; private SpeechRecognizer recognizer; private TextToSpeech tts; private SecureStore store;
    private final int FG=Color.rgb(240,244,255), MUTED=Color.rgb(157,170,198), PANEL=Color.rgb(20,31,52), ACCENT=Color.rgb(113,245,186);

    @Override public void onCreate(Bundle b){ super.onCreate(b); store=new SecureStore(this); buildUi(); initVoice(); if(store.get("gemini").isEmpty()&&store.get("groq").isEmpty()&&store.get("openrouter").isEmpty()) showKeys(); }

    private void buildUi(){
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(18),dp(18),dp(18),dp(18)); root.setBackgroundColor(Color.rgb(8,15,28));
        LinearLayout top=new LinearLayout(this); top.setGravity(Gravity.CENTER_VERTICAL);
        TextView title=text("VoxRelay AI",24,FG); title.setTypeface(null,Typeface.BOLD); top.addView(title,new LinearLayout.LayoutParams(0,dp(52),1));
        Button keys=button("⚙ Klucze",false); keys.setOnClickListener(v->showKeys()); top.addView(keys,new LinearLayout.LayoutParams(dp(110),dp(48))); root.addView(top);
        status=text("AUTO ROUTER • gotowy",13,ACCENT); status.setPadding(0,0,0,dp(12)); root.addView(status);
        ScrollView scroll=new ScrollView(this); log=text("Powiedz coś. Router sam wybierze dostępny model AI i przeczyta odpowiedź głosem.\n",17,FG); log.setLineSpacing(0,1.18f); scroll.addView(log); GradientDrawable p=new GradientDrawable(); p.setColor(PANEL); p.setCornerRadius(dp(22)); scroll.setBackground(p); scroll.setPadding(dp(16),dp(14),dp(16),dp(14)); root.addView(scroll,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1));
        EditText input=new EditText(this); input.setHint("Możesz też wpisać wiadomość…"); input.setTextColor(FG); input.setHintTextColor(MUTED); input.setSingleLine(true); input.setPadding(dp(14),0,dp(14),0); GradientDrawable ib=new GradientDrawable(); ib.setColor(Color.rgb(15,24,42)); ib.setCornerRadius(dp(18)); input.setBackground(ib); root.addView(input,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(54)));
        LinearLayout actions=new LinearLayout(this); actions.setPadding(0,dp(10),0,0);
        Button send=button("Wyślij",false); send.setOnClickListener(v->{ String s=input.getText().toString().trim(); if(!s.isEmpty()){ input.setText(""); send(s);} }); actions.addView(send,new LinearLayout.LayoutParams(0,dp(60),1));
        mic=button("●  MÓW",true); LinearLayout.LayoutParams mp=new LinearLayout.LayoutParams(0,dp(60),1.45f); mp.setMargins(dp(10),0,0,0); actions.addView(mic,mp); mic.setOnClickListener(v->startListening()); root.addView(actions);
        setContentView(root);
    }

    private void initVoice(){
        tts=new TextToSpeech(this,s->{ if(s==TextToSpeech.SUCCESS){ tts.setLanguage(new Locale("pl","PL")); tts.setSpeechRate(1.02f); }});
        recognizer=SpeechRecognizer.createSpeechRecognizer(this); recognizer.setRecognitionListener(new RecognitionListener(){
            public void onReadyForSpeech(Bundle p){ status.setText("SŁUCHAM…"); mic.setText("●  SŁUCHAM"); }
            public void onBeginningOfSpeech(){} public void onRmsChanged(float r){} public void onBufferReceived(byte[] b){} public void onEndOfSpeech(){ status.setText("ROZPOZNAJĘ…"); }
            public void onError(int e){ status.setText("Mikrofon: błąd "+e); mic.setText("●  MÓW"); }
            public void onResults(Bundle r){ mic.setText("●  MÓW"); ArrayList<String> x=r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION); if(x!=null&&!x.isEmpty()) send(x.get(0)); }
            public void onPartialResults(Bundle p){} public void onEvent(int t,Bundle p){}
        });
    }

    private void startListening(){
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){ requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},7); return; }
        Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH); i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM); i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"pl-PL"); i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,false); recognizer.startListening(i);
    }

    private void send(String s){
        history.add(new ProviderRouter.Msg("user",s)); log.append("\nTY\n"+s+"\n"); status.setText("AUTO ROUTER • szukam najlepszego modelu…"); mic.setEnabled(false);
        io.submit(()->{ try{
            ProviderRouter.Reply r=ProviderRouter.ask(history,store); history.add(new ProviderRouter.Msg("assistant",r.text));
            runOnUiThread(()->{ log.append("\nAI  •  "+r.model+"\n"+r.text+"\n"); status.setText("ODPOWIEDZIAŁ: "+r.model); mic.setEnabled(true); if(tts!=null) tts.speak(r.text,TextToSpeech.QUEUE_FLUSH,null,"voxrelay-reply"); });
        }catch(Exception e){ runOnUiThread(()->{ log.append("\nBŁĄD\n"+e.getMessage()+"\n"); status.setText("Router nie znalazł dostępnego modelu"); mic.setEnabled(true); }); }});
    }

    private void showKeys(){
        LinearLayout box=new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); int pad=dp(18); box.setPadding(pad,dp(6),pad,0);
        EditText g=keyField("Gemini API key",store.get("gemini")), q=keyField("Groq API key",store.get("groq")), o=keyField("OpenRouter API key",store.get("openrouter")); box.addView(g); box.addView(q); box.addView(o);
        new AlertDialog.Builder(this).setTitle("Darmowe źródła AI").setMessage("Wystarczy jeden klucz. Router automatycznie przełącza modele przy limicie, timeout lub awarii.").setView(box)
            .setPositiveButton("Zapisz",(d,w)->{ store.put("gemini",g.getText().toString().trim()); store.put("groq",q.getText().toString().trim()); store.put("openrouter",o.getText().toString().trim()); status.setText("AUTO ROUTER • klucze zapisane bezpiecznie"); }).setNegativeButton("Anuluj",null).show();
    }

    private EditText keyField(String hint,String value){ EditText e=new EditText(this); e.setHint(hint); e.setSingleLine(true); e.setText(value); e.setInputType(129); return e; }
    private TextView text(String s,int sp,int color){ TextView t=new TextView(this); t.setText(s); t.setTextSize(sp); t.setTextColor(color); return t; }
    private Button button(String s,boolean accent){ Button b=new Button(this); b.setText(s); b.setAllCaps(false); b.setTextSize(15); b.setTextColor(accent?Color.rgb(7,27,22):FG); GradientDrawable d=new GradientDrawable(); d.setColor(accent?ACCENT:Color.rgb(29,43,69)); d.setCornerRadius(dp(18)); b.setBackground(d); return b; }
    private int dp(int v){ return Math.round(v*getResources().getDisplayMetrics().density); }
    @Override public void onDestroy(){ if(recognizer!=null) recognizer.destroy(); if(tts!=null) tts.shutdown(); io.shutdownNow(); super.onDestroy(); }
}
