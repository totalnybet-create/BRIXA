package pl.voxrelay.ai;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static final String ALIAS="voxrelay_api_keys_v1";
    private final SharedPreferences prefs;
    SecureStore(Context c){ prefs=c.getSharedPreferences("secure",Context.MODE_PRIVATE); ensureKey(); }
    private void ensureKey(){
        try{
            KeyStore ks=KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
            if(!ks.containsAlias(ALIAS)){
                KeyGenerator kg=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
                kg.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
                kg.generateKey();
            }
        }catch(Exception e){ throw new IllegalStateException(e); }
    }
    private SecretKey key() throws Exception { KeyStore ks=KeyStore.getInstance("AndroidKeyStore"); ks.load(null); return ((KeyStore.SecretKeyEntry)ks.getEntry(ALIAS,null)).getSecretKey(); }
    void put(String name,String value){
        try{
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE,key());
            byte[] enc=c.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String packed=Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(enc,Base64.NO_WRAP);
            prefs.edit().putString(name,packed).apply();
        }catch(Exception e){ throw new IllegalStateException(e); }
    }
    String get(String name){
        String packed=prefs.getString(name,""); if(packed==null||packed.isEmpty()) return "";
        try{
            String[] p=packed.split(":",2); byte[] iv=Base64.decode(p[0],Base64.NO_WRAP); byte[] enc=Base64.decode(p[1],Base64.NO_WRAP);
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
            return new String(c.doFinal(enc),StandardCharsets.UTF_8);
        }catch(Exception e){ return ""; }
    }
}
