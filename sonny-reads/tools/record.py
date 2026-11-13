"""Records every story line in the three story-friend voices with ElevenLabs.

Usage:  node tools/manifest.js > manifest.json
        python3 tools/record.py manifest.json voices.json cache_dir audio
voices.json maps hero/monster/dragon to ElevenLabs voice ids. The API key is
sent by the environment; set XI_API_KEY to send one yourself.
Output: audio/<friend>/<page>.mp3, audio/<friend>/bits.mp3 and audio/index.json
(word timings for each page, and where each short clip sits inside bits.mp3).
"""
import json,sys,os,re,base64,hashlib,time,subprocess,urllib.request,urllib.error
from concurrent.futures import ThreadPoolExecutor
import numpy as np
man,vids,cache,out=json.load(open(sys.argv[1])),json.load(open(sys.argv[2])),sys.argv[3],sys.argv[4]
SR=44100;MODEL='eleven_multilingual_v2'
os.makedirs(cache,exist_ok=True)
def tts(voice,text,stamps,tag=''):
    key=hashlib.sha1(f'{voice}|{MODEL}|{stamps}|{text}|{tag}'.encode()).hexdigest()
    f=os.path.join(cache,key+'.json')
    if os.path.exists(f):return json.load(open(f))
    url=f'https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_64'
    body=json.dumps({'text':text,'model_id':MODEL,'voice_settings':{'stability':.5,'similarity_boost':.8,'style':0,'use_speaker_boost':True}}).encode()
    hdr={'Content-Type':'application/json'}
    if os.environ.get('XI_API_KEY'):hdr['xi-api-key']=os.environ['XI_API_KEY']
    for n in range(6):
        try:
            r=json.load(urllib.request.urlopen(urllib.request.Request(url,data=body,headers=hdr),timeout=120));break
        except urllib.error.HTTPError as e:
            msg=e.read()[:300]
            if e.code in(429,500,502,503,504) and n<5:time.sleep(3*(n+1));continue
            raise RuntimeError(f'{e.code} {msg}')
        except Exception:
            if n<5:time.sleep(3*(n+1));continue
            raise
    json.dump(r,open(f,'w'));return r
def pcm(mp3):
    raw=subprocess.run(['ffmpeg','-v','quiet','-i','pipe:0','-ac','1','-ar',str(SR),'-f','s16le','-'],input=mp3,capture_output=True).stdout
    return np.frombuffer(raw,dtype=np.int16)
def trim(x):
    idx=np.where(np.abs(x.astype(np.int32))>500)[0]
    if not len(idx):return x
    pad=int(.06*SR);return x[max(0,idx[0]-pad):idx[-1]+pad]
def word_times(text,al):
    ch,st,en=al['characters'],al['character_start_times_seconds'],al['character_end_times_seconds']
    res=[];pos=0;same=''.join(ch)==text
    for tok in text.split(' '):
        a,b=pos,pos+len(tok)-1;pos+=len(tok)+1
        if not re.sub(r"[^A-Za-z'-]",'',tok):res.append(None);continue
        if same:res.append([round(st[a],2),round(en[b],2)])
        else:
            T=en[-1];L=len(text);res.append([round(T*a/L,2),round(T*(b+1)/L,2)])
    return res,same
index={};jobs=[]
for k,v in vids.items():
    os.makedirs(os.path.join(out,k),exist_ok=True)
    for p in man['pages']:jobs.append((k,v,'page',p['id'],p['text']))
    for w in man['words']:jobs.append((k,v,'bit','w:'+w,w[0].upper()+w[1:]+'.'))
    for s in man['says']:jobs.append((k,v,'bit','s:'+s,s))
    for n,l in man['lines'][k].items():jobs.append((k,v,'bit','l:'+n,l))
def run(j):
    k,v,kind,key,text=j
    r=tts(v,text,True)
    if kind=='bit':
        x=trim(pcm(base64.b64decode(r['audio_base64'])));limit=(2.2 if key[0]=='w' else 1.2+len(text)*.16)
        for attempt in range(1,4):
            if .15<len(x)/SR<limit:break
            r=tts(v,text,True,f'retry{attempt}');x=trim(pcm(base64.b64decode(r['audio_base64'])))
        return j,x
    return j,r
with ThreadPoolExecutor(3) as ex:results=list(ex.map(run,jobs))
bits={k:[] for k in vids};odd=[]
for (k,v,kind,key,text),r in results:
    d=index.setdefault(k,{'pages':{},'bits':{}})
    if kind=='page':
        open(os.path.join(out,k,key+'.mp3'),'wb').write(base64.b64decode(r['audio_base64']))
        d['pages'][key],same=word_times(text,r['alignment'])
        if not same:odd.append((k,key,'alignment text differs'))
    else:
        t0=sum(len(b) for b in bits[k])/SR
        d['bits'][key]=[round(t0,2),round(t0+len(r)/SR,2)]
        if len(r)/SR>(2.2 if key[0]=='w' else 1.2+len(text)*.16):odd.append((k,key,'long %.1fs'%(len(r)/SR)))
        bits[k]+= [r,np.zeros(int(.45*SR),dtype=np.int16)]
for k,parts in bits.items():
    subprocess.run(['ffmpeg','-v','quiet','-y','-f','s16le','-ar',str(SR),'-ac','1','-i','pipe:0','-b:a','64k',os.path.join(out,k,'bits.mp3')],input=np.concatenate(parts).tobytes(),check=True)
json.dump(index,open(os.path.join(out,'index.json'),'w'),separators=(',',':'))
print('done',len(results),'clips; check these:',odd)
