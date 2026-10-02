"""Package original Blender PNGs as transparent WebP and build labeled review sheets.
Run after render_inventory.py with a Python interpreter providing Pillow.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'art/inventory';OUT=ROOT/'src/assets/inventory';OUT.mkdir(parents=True,exist_ok=True)
NAMES=['weapon-longsword','weapon-knife','weapon-axe','weapon-spear','weapon-bow','armor-cloth','armor-leather','armor-mail','ration','stock-smoke','potion-look-red','potion-look-blue','potion-look-green','potion-look-violet','potion-look-amber','potion-look-silver','scroll-look-ash','scroll-look-tide','scroll-look-thorn','scroll-look-star','scroll-upgrade','stock-stone','stock-arrow','stock-arrow-chill','stock-arrow-paralysis']
LABELS=['LONGSWORD','HUNTING KNIFE','HEAVY AXE','LONG SPEAR','ASH BOW','PADDED CLOTH','BUCKLED LEATHER','RIVETED MAIL','TRAVEL RATION','SMOKE FLASK','RED APPEARANCE','BLUE APPEARANCE','GREEN APPEARANCE','VIOLET APPEARANCE','AMBER APPEARANCE','SILVER APPEARANCE','ASH ORNAMENT','TIDE ORNAMENT','THORN ORNAMENT','STAR ORNAMENT','BRONZE UPGRADE SEAL','THROWING STONES','STANDARD ARROWS','CHILL ARROWS','PARALYSIS ARROWS']
manifest=[]
for name in NAMES:
    im=Image.open(ART/'renders'/(name+'.png')).convert('RGBA')
    assert im.size==(512,512),(name,im.size)
    alpha=im.getchannel('A');bbox=alpha.getbbox()
    assert bbox and min(bbox[0],bbox[1],512-bbox[2],512-bbox[3])>=12,(name,'clipping risk',bbox)
    dest=OUT/(name+'.webp')
    if not dest.exists() or dest.stat().st_mtime < (ART/'renders'/(name+'.png')).stat().st_mtime:
        im.save(dest,'WEBP',quality=90,method=6,exact=True)
    with Image.open(dest) as check:
        assert check.size==(512,512) and check.mode=='RGBA'
        assert check.getchannel('A').getextrema()==(0,255)
    manifest.append({'file':dest.name,'width':512,'height':512,'bytes':dest.stat().st_size,'alphaBounds':bbox})
assert sum(x['bytes'] for x in manifest)<1500000
(ART/'asset-manifest.json').write_text(json.dumps({'totalBytes':sum(x['bytes'] for x in manifest),'count':len(manifest),'files':manifest},indent=2)+'\n')
fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def sheet(path,size,cellw,cellh,fontsize):
    width=5*cellw;header=75;canvas=Image.new('RGB',(width,header+5*cellh+36),'#171c20');d=ImageDraw.Draw(canvas)
    f=ImageFont.truetype(fontpath,fontsize);title=ImageFont.truetype(fontpath,23)
    d.text((22,14),'SUPERDUNGEON / FIELD INVENTORY',font=title,fill='#d2c9b5')
    d.text((22,45),'Original Blender models · transparent assets · appearance-safe variants',font=f,fill='#80908f')
    for i,(name,label) in enumerate(zip(NAMES,LABELS)):
        x=(i%5)*cellw;y=header+(i//5)*cellh
        d.rounded_rectangle((x+7,y+5,x+cellw-7,y+cellh-5),8,fill='#21282b',outline='#343e40',width=1)
        im=Image.open(OUT/(name+'.webp')).convert('RGBA');im.thumbnail((size,size),Image.Resampling.LANCZOS)
        canvas.paste(im,(x+(cellw-im.width)//2,y+9),im)
        tw=d.textlength(label,font=f);d.text((x+(cellw-tw)/2,y+size+15),label,font=f,fill='#c1c5bb')
    d.text((22,canvas.height-25),'512 × 512 WebP source  |  25 original assets  |  no baked labels, borders or counts',font=f,fill='#85928b')
    canvas.save(path)
sheet(ART/'contact-sheet.png',240,268,280,13)
sheet(ART/'contact-sheet-112px.png',112,172,153,10)
print(json.dumps({'count':len(manifest),'totalBytes':sum(x['bytes'] for x in manifest),'maxBytes':max(x['bytes'] for x in manifest)},indent=2))
