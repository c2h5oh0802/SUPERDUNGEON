"""Original SUPERDUNGEON inventory models. Run: blender -b -t 2 --python scripts/art/render_inventory.py
No downloaded meshes, images, fonts or textures. Deterministic procedural assets.
"""
import bpy, math, random, json, os, sys
from mathutils import Vector
from pathlib import Path
from math import sin, cos, pi
random.seed(91304)
ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'art/inventory'
RENDERS=ART/'renders'
RENDERS.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name!='Collection': bpy.data.collections.remove(c)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=64
scene.cycles.use_denoising=False; scene.cycles.seed=91304
scene.cycles.max_bounces=8; scene.cycles.transmission_bounces=6
scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.render.image_settings.color_depth='8'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.world.color=(.22,.24,.29)
world=bpy.data.worlds.new('Cool studio environment');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.32,.36,.44,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
ACTIVE=None
ASSETS={}

def color(h):
    if isinstance(h, str): h=int(h.replace('#',''),16)
    c=[((h >> s)&255)/255 for s in (16,8,0)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)

def mat(name,h,metal=0,rough=.5,noise=0,scale=12,trans=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;links=m.node_tree.links;p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color(h),1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Transmission Weight'].default_value=trans
    if trans:p.inputs['IOR'].default_value=1.46
    if noise:
        tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=scale;tex.inputs['Detail'].default_value=3;tex.inputs['Roughness'].default_value=.7
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=noise;bump.inputs['Distance'].default_value=.055
        links.new(tex.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
        ramp=n.new('ShaderNodeValToRGB');base=color(h)
        ramp.color_ramp.elements[0].position=.12;ramp.color_ramp.elements[0].color=(*(v*.6 for v in base),1)
        ramp.color_ramp.elements[1].position=.88;ramp.color_ramp.elements[1].color=(*(min(1,v*1.25) for v in base),1)
        links.new(tex.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs['Color'],p.inputs['Base Color'])
    return m
STEEL=mat('Forged steel | worn satin edges','#a3afbc',.83,.28,.12,85)
EDGE=mat('Ground steel edges','#d4dee2',.88,.19)
IRON=mat('Blackened iron','#323b41',.82,.38,.18,48)
BRASS=mat('Aged brass','#af8043',.75,.3,.11,38)
BRONZE=mat('Old bronze seal','#b77f3e',.72,.27,.1,29)
WOOD=mat('Dark ash wood','#624126',0,.5,.3,18)
LEATHER=mat('Oiled leather','#513322',0,.55,.25,62)
LEATHERLIGHT=mat('Russet leather panels','#815535',0,.48,.26,65)
CLOTH=mat('Charcoal linen','#686862',0,.9,.5,155)
DARKCLOTH=mat('Shadow linen','#383a37',0,.93,.5,125)
STITCH=mat('Flax stitching','#a99773',0,.9,.12,140)
PAPER=mat('Rough parchment','#bea77b',0,.89,.4,33)
PAPEREDGE=mat('Worn parchment edge','#765735',0,.82,.3,44)
INK=mat('Carbon pigment','#35302a',0,.85)
CORD=mat('Hemp cord','#ab9470',0,.9,.45,90)
GLASS=mat('Clear thick blown glass','#e1edf0',0,.075,0,1,.98)
CORK=mat('Natural cork','#8b6743',0,.92,.7,66)
FEATHER=mat('Natural goose feather','#c1b8a0',0,.77,.1,70)

def activate(name):
    global ACTIVE
    c=bpy.data.collections.new(name);scene.collection.children.link(c);ACTIVE=c;ASSETS[name]=c
    return c

def add(o,m=None,name=None):
    if name:o.name=name
    for c in list(o.users_collection):c.objects.unlink(o)
    ACTIVE.objects.link(o)
    if m:o.data.materials.append(m)
    return o

def bevel(o,v=.025,seg=2):
    mod=o.modifiers.new('Light-catching hand worked edges','BEVEL');mod.width=v;mod.segments=seg
    mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o

def cube(name,loc,scale,m,b=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=add(bpy.context.object,m,name);o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if b:bevel(o,b,3)
    return o

def uv(name,loc,scale,m,seg=32,rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,radius=1,location=loc);o=add(bpy.context.object,m,name);o.scale=scale
    for p in o.data.polygons:p.use_smooth=True
    return o

def cyl(name,loc,r,depth,m,vertices=32,r2=None):
    if r2 is None:bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc)
    else:bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r2,depth=depth,location=loc)
    o=add(bpy.context.object,m,name);bevel(o,min(.017,r/4),2)
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o

def between(name,a,b,r,m,verts=16):
    a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(b-a).length,m,verts);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def curve(name,points,r,m,cyclic=False):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=2
    s=cu.splines.new('POLY');s.points.add(len(points)-1)
    for q,p in zip(s.points,points):q.co=(*p,1)
    s.use_cyclic_u=cyclic;cu.bevel_depth=r;cu.bevel_resolution=3
    o=bpy.data.objects.new(name,cu);ACTIVE.objects.link(o);cu.materials.append(m);return o

def torus(name,loc,major,minor,m,rot=(0,0,0),segments=32):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=segments,minor_segments=8,location=loc,rotation=rot)
    o=add(bpy.context.object,m,name)
    for p in o.data.polygons:p.use_smooth=True
    return o

def poly(name,pts,depth,m,y=0,b=.018):
    # silhouette in X/Z, thickness along Y
    n=len(pts);vs=[(x,y-depth/2,z) for x,z in pts]+[(x,y+depth/2,z) for x,z in pts]
    fs=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    fs += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update();o=bpy.data.objects.new(name,mesh);ACTIVE.objects.link(o);o.data.materials.append(m)
    if b:bevel(o,b,3)
    return o

def lathe(name,profile,m,segments=48):
    vs=[]
    for r,z in profile:
        for i in range(segments):
            a=2*pi*i/segments;vs.append((r*cos(a),r*sin(a),z))
    fs=[]
    for j in range(len(profile)-1):
        for i in range(segments):
            k=j*segments+i;l=j*segments+(i+1)%segments;fs.append((k,l,l+segments,k+segments))
    fs += [tuple(range(segments-1,-1,-1)),tuple((len(profile)-1)*segments+i for i in range(segments))]
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);ACTIVE.objects.link(o);me.materials.append(m)
    for p in me.polygons:p.use_smooth=True
    return o

def rivet(x,z,y=-.17,r=.034,m=BRASS):
    return uv('Hammered rivet',(x,y,z),(r,r*.45,r),m,16,8)

def buckle(x,z,w=.24,h=.18,y=-.21):
    pts=[(x-w/2,y,z-h/2),(x+w/2,y,z-h/2),(x+w/2,y,z+h/2),(x-w/2,y,z+h/2)]
    curve('Forged buckle frame',pts,.025,BRASS,True);between('Buckle tongue',(x-w*.28,y-.009,z),(x+w*.54,y-.009,z),.011,BRASS)

def wrap(z0,z1,r=.085,step=.055,m=LEATHER):
    pts=[]
    for i in range(int((z1-z0)/step*32)+1):
        a=i/32*2*pi;z=z0+(z1-z0)*i/max(1,int((z1-z0)/step*32));pts.append((r*cos(a),r*sin(a),z))
    curve('Spiral grip binding',pts,.017,m)

def blade(name,z0,z1,width,m=STEEL):
    # central ridge, independently catching light, taper to a real point
    coords=[(-width/2,0,z0),(width/2,0,z0),(-width*.42,0,z1-.22),(width*.42,0,z1-.22),(0,0,z1),(0,-.055,z0),(0,.04,z0),(0,-.034,z1-.22),(0,.025,z1-.22)]
    fs=[(0,5,7,2),(5,1,3,7),(2,7,4),(7,3,4),(1,6,8,3),(6,0,2,8),(3,8,4),(8,2,4),(0,6,1,5)]
    me=bpy.data.meshes.new(name);me.from_pydata(coords,[],fs);me.update();o=bpy.data.objects.new(name,me);ACTIVE.objects.link(o);me.materials.append(m);bevel(o,.004,2);return o

# LONGSWORD: straight narrow blade, broad brass guard and wooden grip, as in viewmodel.ts.
activate('weapon-longsword')
blade('Long diamond-section blade',.1,3,.22)
for x in [-.027,.027]:between('Forged blade fuller',(x,-.055,.2),(x,-.038,2.55),.009,IRON,8)
poly('Broad brass crossguard',[(-.52,-.02),(-.5,.075),(-.18,.14),(.18,.14),(.5,.075),(.52,-.02),(.19,.015),(-.19,.015)],.14,BRASS,b=.016)
cyl('Wooden grip core',(0,0,-.32),.072,.65,WOOD,12);wrap(-.61,-.04,.079,.057,LEATHER)
cyl('Pommel collar',(0,0,-.66),.087,.06,BRASS)
uv('Wheel pommel',(0,0,-.75),(.125,.09,.125),BRASS,16,8)
# SHORT HUNTING KNIFE
activate('weapon-knife')
blade('Short broad hunting blade',.05,1.18,.29)
poly('Short steel guard',[(-.22,-.035),(-.23,.03),(-.18,.08),(.18,.08),(.23,.03),(.22,-.035)],.14,IRON)
poly('Full tang ergonomic grip',[(-.085,.02),(-.12,-.13),(-.09,-.37),(-.12,-.56),(-.06,-.65),(.075,-.62),(.095,-.4),(.08,-.15),(.07,.02)],.12,LEATHERLIGHT)
for z in [-.13,-.47]:rivet(0,z,y=-.075,r=.032,m=STEEL)
poly('Exposed tang butt',[(-.1,-.57),(-.06,-.67),(.07,-.64),(.1,-.58)],.135,IRON)
# ONE-SIDED HEAVY AXE
activate('weapon-axe')
cyl('Heavy ash handle',(0,0,-.14),.071,2.6,WOOD,12,r2=.058);wrap(-1.35,-.72,.077,.062,LEATHER)
poly('Single-sided forged axe head',[(-.13,1.11),(.25,1.2),(.8,1.36),(.89,1.04),(.91,.67),(.77,.43),(.25,.6),(-.13,.65)],.19,STEEL)
poly('Bright honed axe edge',[(.77,.43),(.91,.67),(.89,1.04),(.8,1.36),(.71,1.29),(.78,1.02),(.78,.72),(.68,.51)],.2,EDGE,b=.008)
cube('Head socket',(0,0,.91),(.24,.26,.5),IRON,.06);cyl('Top wedge',(0,0,1.22),.093,.06,STEEL,8)
for z in [.7,1.09]:torus('Socket collar',(0,0,z),.116,.018,BRASS)
# LONG NARROW SPEAR
activate('weapon-spear')
cyl('Long ash spear shaft',(0,0,-.3),.044,3.9,WOOD,10,r2=.038)
blade('Narrow spear point',1.63,2.32,.23)
cyl('Spear socket',(0,0,1.56),.066,.3,IRON,12,r2=.047)
for z in [1.44,1.53]:torus('Socket retaining bands',(0,0,z),.066,.016,BRASS)
wrap(-.1,.43,.047,.046,LEATHER)
cyl('Iron heel',(0,0,-2.31),.047,.2,IRON,10,r2=.025)
# SIMPLE ASH HUNTING BOW
activate('weapon-bow')
pts=[]
for i in range(61):
    z=-1.7+3.4*i/60;x=.62*(1-(abs(z)/1.7)**1.6);pts.append((x,0,z))
curve('Continuous curved ash stave',pts,.056,WOOD)
curve('Outer dark growth ring',[(x-.031,-.04,z) for x,y,z in pts],.012,LEATHER)
curve('Taut linen bowstring',[(0,-.01,-1.7),(0,-.01,1.7)],.012,CORD)
for z in [-1.64,1.64]:between('Horn nock',(0,-.002,z-.07),(.025,-.002,z+.07),.06,IRON)
for z in [i*.045 for i in range(-4,5)]:
    torus('Leather bow grip',(.615,0,z),.067,.015,LEATHER,rot=(0,0,0))
# ARMOR MODEL COMMON SILHOUETTE
outline=[(-.55,1.13),(-.3,1.22),(-.21,1.04),(0,.99),(.21,1.04),(.3,1.22),(.55,1.13),(.91,.91),(1.05,.45),(.77,.31),(.58,.55),(.57,-.44),(.66,-1.17),(.3,-1.24),(0,-1.19),(-.3,-1.24),(-.66,-1.17),(-.57,-.44),(-.58,.55),(-.77,.31),(-1.05,.45),(-.91,.91)]

def shirt(name,material):
    poly(name,outline,.32,material,y=0,b=.055)
    curve('Tailored collar seam',[(-.3,-.18,1.22),(-.2,-.22,1.03),(0,-.23,.97),(.2,-.22,1.03),(.3,-.18,1.22)],.035,DARKCLOTH)
    for a,b in [((-.99,-.18,.47),(-.8,-.19,.35)),((.99,-.18,.47),(.8,-.19,.35))]:between('Sleeve cuff',a,b,.045,DARKCLOTH)
    curve('Heavy bottom hem',[(-.64,-.18,-1.15),(-.29,-.2,-1.22),(0,-.2,-1.17),(.29,-.2,-1.22),(.64,-.18,-1.15)],.037,DARKCLOTH)
activate('armor-cloth');shirt('Padded linen gambeson',CLOTH)
for x in [-.43,-.27,-.1,.1,.27,.43]:
    curve('Quilted vertical channel',[(x,-.168,.81),(x*.92,-.19,.34),(x*.98,-.195,-.35),(x*1.1,-.18,-1.12)],.011,STITCH)
for z in [.68,.12,-.42,-.97]:
    curve('Cross quilting stitch',[(-.5,-.18,z),(0,-.193,z-.03),(.5,-.18,z)],.008,DARKCLOTH)
for z in [.76,.51,.26]:
    curve('Neck lacing',[(-.085,-.24,z+.07),(.085,-.24,z-.07)],.017,CORD)
cube('Simple woven waist belt',(0,-.21,-.39),(1.19,.08,.14),LEATHER,.018);buckle(.12,-.39,.23,.18,-.268)
activate('armor-leather');shirt('Dark underlayer',DARKCLOTH)
poly('Left fitted leather breast',[(-.5,1.11),(-.27,1.16),(-.16,.91),(-.08,.76),(-.07,-.88),(-.53,-.91),(-.57,-.42),(-.49,.38)],.13,LEATHERLIGHT,y=-.22,b=.055)
poly('Right fitted leather breast',[(.5,1.11),(.27,1.16),(.16,.91),(.08,.76),(.07,-.88),(.53,-.91),(.57,-.42),(.49,.38)],.13,LEATHERLIGHT,y=-.22,b=.055)
for s in [-1,1]:
    poly('Reinforced shoulder cap',[(s*.47,1.15),(s*.64,1.08),(s*.92,.92),(s*.86,.61),(s*.57,.73)],.17,LEATHER,y=-.18,b=.05)
    for z in [.7,.1,-.71]:rivet(s*.43,z,-.301,.03)
for z in [.64,.13,-.39]:
    cube('Broad securing strap',(0,-.328,z),(1.03,.08,.14),LEATHER,.025);buckle(.16,z,.27,.21,-.39)
    for x in [-.32,-.24,-.16]:rivet(x,z,-.382,.014,m=IRON)
for x in [-.4,0,.4]:
    poly('Overlapping skirt panel',[(x-.19,-.58),(x+.19,-.58),(x+.22,-1.22),(x-.19,-1.2)],.1,LEATHERLIGHT,y=-.22,b=.035)
activate('armor-mail');shirt('Charcoal chainmail backing',DARKCLOTH)
# Actual alternating interlocked steel rings; no texture shortcut. Shared mesh for compact .blend.
ring_template=torus('Mail link template',(0,0,0),.048,.012,STEEL,rot=(pi/2,0,0),segments=12)
ring_mesh=ring_template.data;bpy.data.objects.remove(ring_template,do_unlink=True)
for row in range(27):
    z=-1.11+row*.083
    width=.56 if z<.82 else .47
    for col in range(-7,8):
        x=col*.077+(row%2)*.038
        if abs(x)>width:continue
        if z>.9 and abs(x)<.26:continue
        o=bpy.data.objects.new('Riveted steel mail link',ring_mesh);ACTIVE.objects.link(o);o.location=(x,-.225,z);o.rotation_euler=(pi/2+(.22 if row%2 else -.22),0,0)
for side in [-1,1]:
    for row in range(7):
        for col in range(4):
            x=side*(.57+col*.077);z=.5+row*.08-abs(x-.57*side)*.35
            o=bpy.data.objects.new('Mail sleeve link',ring_mesh);ACTIVE.objects.link(o);o.location=(x,-.2,z);o.rotation_euler=(pi/2+.17*(row%2),0,0)
curve('Leather-bound mail collar',[(-.28,-.25,1.2),(-.2,-.28,1.01),(0,-.28,.93),(.2,-.28,1.01),(.28,-.25,1.2)],.048,LEATHER)
cube('Chainmail waist belt',(0,-.28,-.43),(1.2,.08,.125),LEATHER,.025);buckle(.1,-.43,.21,.17,-.338)
# SIX POTS: exactly identical mesh/form/cork; base liquid colors are config POTION_LOOKS values.
POTION_COLORS={'red':'#e0504a','blue':'#4a78e0','green':'#4ec46a','violet':'#a060e0','amber':'#e0a040','silver':'#d8e2e8'}
def potion(name,hexcolor):
    activate(name)
    profile=[(.0,-.6),(.24,-.6),(.4,-.54),(.49,-.36),(.53,-.08),(.49,.21),(.37,.42),(.17,.53),(.145,.72),(.18,.73),(.185,.82),(.14,.85),(.119,.82),(.12,.71),(.12,.54),(.34,.395),(.455,.19),(.491,-.08),(.454,-.35),(.36,-.5),(.23,-.555),(0,-.555)]
    lathe('Hand-blown clear glass bottle',profile,GLASS)
    liquid=mat('Liquid appearance '+hexcolor,hexcolor,.08,.23)
    lathe('Colored liquid | appearance only',[(0,-.545),(.22,-.545),(.35,-.49),(.446,-.34),(.481,-.08),(.46,.16),(.432,.24),(0,.24)],liquid)
    cyl('Unmarked cork stopper',(0,0,.895),.143,.21,CORK,20,r2=.165)
    torus('Glass lip',(0,0,.798),.17,.028,GLASS)
    torus('Neck cord lower',(0,0,.58),.157,.018,CORD)
    torus('Neck cord upper',(0,0,.62),.157,.018,CORD)
    curve('Cord tie',[(.03,-.166,.62),(.11,-.185,.51),(.07,-.19,.37)],.014,CORD)
for k,v in POTION_COLORS.items():potion('potion-look-'+k,v)
# SCROLLS: surface motifs correspond only to randomized appearance families.
def scroll(name,theme):
    activate(name)
    poly('Worn open parchment',[(-.63,1.02),(.6,1.04),(.64,.48),(.615,.07),(.65,-.89),(.28,-.96),(-.22,-.92),(-.63,-1.0),(-.6,-.3)],.045,PAPER,y=.0,b=.02)
    for z in [-.97,1.04]:
        o=cyl('Rolled parchment edge',(0,-.03,z),.14,1.35,PAPER,32);o.rotation_euler[1]=pi/2
        for side in [-1,1]:
            pts=[]
            for i in range(70):
                a=i/69*pi*4;r=.017+.10*i/69;pts.append((side*.678,-.03+r*cos(a),z+r*sin(a)))
            curve('Visible parchment roll spiral',pts,.008,PAPEREDGE)
    # Very faint neutral manuscript marks, with ample blank space around the motif.
    for z in [.71,.6,-.58,-.7]:
        for j in range(4):
            x=-.44+j*.24;curve('Faded manuscript dash',[(x,-.036,z),(x+.13+(.02 if j%2 else 0),-.037,z+.009)],.007,PAPEREDGE)
    yy=-.049
    if theme=='ash':
        for z in [-.25,0,.25]:
            curve('Ash lozenge',[(0,yy,z+.13),(.19,yy,z),(0,yy,z-.1),(-.19,yy,z),(0,yy,z+.13)],.022,INK)
        for x,z in [(-.32,.18),(.31,-.18),(.28,.31),(-.25,-.34)]:uv('Ash speck',(x,yy,z),(.026,.011,.026),INK,10,6)
    elif theme=='tide':
        for z in [-.27,0,.27]:curve('Tidal wave ornament',[(x,yy,z+.075*sin((x+.4)*pi*2.5)) for x in [-.4+i*.02 for i in range(41)]],.024,INK)
    elif theme=='thorn':
        curve('Thorn ornamental stem',[(0,yy,-.42),(-.06,yy,-.17),(.04,yy,.12),(-.02,yy,.4)],.024,INK)
        for z,s in [(-.25,-1),(-.03,1),(.18,-1),(.32,1)]:curve('Thorn decorative branch',[(0,yy,z),(s*.24,yy,z+.09),(s*.18,yy,z-.025)],.023,INK)
    elif theme=='star':
        pts=[]
        for i in range(16):
            a=pi/2+i*pi/8;r=.35 if i%2==0 else .14;pts.append((r*cos(a),yy,r*sin(a)))
        curve('Eight point celestial ornament',pts,.022,INK,True)
        for x,z in [(-.4,.4),(.4,.4),(-.4,-.4),(.4,-.4)]:uv('Celestial dot',(x,yy,z),(.028,.015,.028),INK,10,6)
    else:
        # Metallic bronze seal means the always-known upgrade scroll, never an unknown-effect mark.
        o=cyl('Bronze upgrade seal',(0,-.092,.04),.29,.09,BRONZE,12);o.rotation_euler[0]=pi/2
        torus('Seal raised rim',(0,-.15,.04),.23,.024,BRASS,rot=(pi/2,0,0))
        for z in [-.015,.115]:curve('Embossed neutral chevron',[(-.11,-.163,z),(.0,-.163,z+.075),(.11,-.163,z)],.021,BRASS)
        for side in [-1,1]:poly('Seal ribbon',[(side*.04,-.18),(side*.18,-.18),(side*.21,-.55),(side*.12,-.48),(side*.05,-.56)],.022,LEATHER,y=-.055,b=.003)
for theme in ['ash','tide','thorn','star','upgrade']:scroll('scroll-'+('upgrade' if theme=='upgrade' else 'look-'+theme),theme)
# RATION: bread, dried meat, waxed cloth and twine, no modern package label.
activate('ration')
BREAD=mat('Ration bread crust','#9c6939',0,.83,.72,16)
MEAT=mat('Dried meat','#62362b',0,.64,.45,31)
uv('Dark travel loaf',(-.15,0,.11),(.55,.34,.51),BREAD,28,16)
for x in [-.4,-.17,.06]:curve('Cut loaf score',[(x,-.30,.14),(x+.08,-.325,.29),(x+.13,-.25,.44)],.018,PAPEREDGE)
for i in range(3):
    poly('Dried meat strip',[(.05+i*.1,-.38),(.24+i*.1,-.28),(.39+i*.1,.42),(.24+i*.1,.55)],.08,MEAT,y=-.3-i*.02,b=.04)
poly('Folded waxed cloth wrapper',[(-.7,-.37),(-.49,-.57),(.43,-.57),(.67,-.37),(.58,.05),(.16,-.08),(-.36,.07)],.23,CLOTH,y=-.36,b=.08)
curve('Wrapped ration cord',[(-.56,-.42,-.18),(-.23,-.51,-.1),(.24,-.51,-.07),(.61,-.42,-.07)],.025,CORD)
curve('Crossed ration cord',[(0,-.52,-.54),(.03,-.52,-.1),(.09,-.36,.28)],.023,CORD)
curve('Ration tie bow',[(-.04,-.57,-.14),(-.21,-.57,-.04),(-.27,-.55,-.1),(-.14,-.56,-.2),(.06,-.56,-.15),(.23,-.54,-.06),(.26,-.55,-.16),(.1,-.57,-.22)],.019,CORD)
# SMOKE FLASK: opaque ceramic and iron, completely distinct from glass potion silhouettes.
activate('stock-smoke')
SMOKE=mat('Smoked grey ceramic','#555761',.08,.51,.24,45)
lathe('Squared shoulder smoke flask',[(0,-.55),(.28,-.55),(.37,-.45),(.39,.24),(.33,.4),(.13,.48),(.12,.7),(0,.7)],SMOKE,12)
for z in [-.38,.21]:cyl('Black iron flask hoop',(0,0,z),.4,.085,IRON,12)
cyl('Wrapped cloth stopper',(0,0,.74),.145,.2,CLOTH,12)
curve('Short folded wick',[(0,0,.82),(.06,0,.99),(.17,-.01,1.05),(.23,-.02,1.00)],.035,CORD)
cube('Vertical retaining strap',(0,-.391,-.07),(.14,.038,.67),LEATHER,.015)
for z in [-.3,.16]:rivet(0,z,-.422,.038,m=STEEL)
# THROWING STONES: three irregular hand-sized rocks.
activate('stock-stone')
STONE=mat('Weathered slate','#89918f',0,.88,.48,10)
for idx,(loc,scale) in enumerate([((-.25,.07,-.06),(.52,.39,.43)),((.37,.06,-.22),(.37,.32,.31)),((.05,-.27,-.39),(.39,.31,.22))]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=loc);o=add(bpy.context.object,STONE,'Irregular throwing stone')
    for v in o.data.vertices:v.co*=random.uniform(.89,1.13)
    o.scale=scale;o.rotation_euler=(.3*idx,.8*idx,.6*idx);bevel(o,.015,2)
# ARROW BUNDLES: utilitarian broadheads, fletching and appearance-coded tips.
def arrows(name,h):
    activate(name);tip=STEEL if h is None else mat('Treated arrow tip '+h,h,.5,.23)
    feather=FEATHER if h is None else mat('Dyed fletching '+h,h,0,.7,.17,35)
    for idx in range(3):
        x=(idx-1)*.15;y=(idx%2)*.09;bottom=-1.2+idx*.12;top=1.04+idx*.12
        between('Straight wooden arrow shaft',(x,y,bottom),(x,y,top),.027,WOOD,10)
        head=poly('Forged leaf arrowhead',[(x-.09,top-.1),(x,top+.28),(x+.09,top-.1),(x+.035,top-.05),(x-.035,top-.05)],.027,tip,y=y,b=.003)
        for s in [-1,1]:poly('Cut feather fletching',[(x,bottom+.09),(x+s*.13,bottom+.02),(x+s*.1,bottom+.45),(x,bottom+.58)],.012,feather,y=y-.009,b=.003)
        for z in [bottom+.12,bottom+.53,top-.1]:
            o=torus('Arrow binding',(x,y,z),.03,.013,CORD,segments=12)
    curve('Bundle tie',[(.25*cos(a),.11*sin(a),-.05+.015*sin(2*a)) for a in [i*pi/16 for i in range(33)]],.024,CORD,True)
arrows('stock-arrow',None);arrows('stock-arrow-chill','#7cc8ff');arrows('stock-arrow-paralysis','#c08cff')

# Turn only long objects diagonally; all objects share the same studio camera/light rig.
for name,c in ASSETS.items():
    if name.startswith('weapon-') or name.startswith('stock-arrow'):
        angle=math.radians(24 if name!='weapon-bow' else -17)
        from mathutils import Matrix
        matx=Matrix.Rotation(angle,4,'Y')
        for o in c.objects:o.matrix_world=matx @ o.matrix_world
    elif name.startswith('scroll-'):
        from mathutils import Matrix
        matx=Matrix.Rotation(math.radians(-8),4,'Y')
        for o in c.objects:o.matrix_world=matx @ o.matrix_world

# Softbox rig, never baked into the transparent alpha.
rig=bpy.data.collections.new('STUDIO | camera and softboxes');scene.collection.children.link(rig)
ACTIVE=rig
bpy.ops.object.camera_add(location=(3,-8,5));cam=add(bpy.context.object,None,'Inventory orthographic camera');scene.camera=cam;cam.data.type='ORTHO';cam.data.lens=70

def area(name,loc,power,size,hex):
    bpy.ops.object.light_add(type='AREA',location=loc);o=add(bpy.context.object,None,name);o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=color(hex);o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler();return o
area('Large warm key',(-3,-4,7),900,5,'#fff0d9')
area('Cool edge softbox',(4,2,5),1100,4,'#c6deff')
area('Broad frontal fill',(0,-5,1),450,4,'#e8edff')
area('Thin steel highlight',(-4,1,2),500,3,'#ffffff')

def frame(c):
    bpy.context.view_layer.update()
    points=[]
    for o in c.objects:
        if o.type in ['MESH','CURVE']:
            points += [o.matrix_world@Vector(b) for b in o.bound_box]
    center=(Vector(tuple(min(v[i] for v in points) for i in range(3)))+Vector(tuple(max(v[i] for v in points) for i in range(3))))/2
    direction=Vector((2.2,-8,4.2)).normalized()
    cam.location=center+direction*10;cam.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler()
    inverse=cam.matrix_world.inverted();bpy.context.view_layer.update();inverse=cam.matrix_world.inverted()
    projected=[inverse@v for v in points]
    xs=[v.x for v in projected];ys=[v.y for v in projected]
    width=max(xs)-min(xs);height=max(ys)-min(ys)
    cam.data.ortho_scale=max(width,height)*1.17
    # Recenter asymmetrical shapes by their actual screen bounds.
    cam.location+=cam.rotation_euler.to_matrix()@Vector(((max(xs)+min(xs))/2,(max(ys)+min(ys))/2,0))
    return {'orthoScale':cam.data.ortho_scale,'objects':len(c.objects)}
metadata={name: {'objects': len(c.objects), 'samples': 512 if name.startswith('potion-') else 64, 'projection': 'ORTHO'} for name,c in ASSETS.items()}
for name,c in ASSETS.items():
    c.hide_render=True
    c['asset_filename']=name+'.webp'
    c['recommended_cycles_samples']=512 if name.startswith('potion-') else 64
selected=os.environ.get('INVENTORY_ASSETS','').split(',')
if selected==['']:selected=list(ASSETS)
# Preserve every editable asset in one self-contained .blend; visibility chooses longsword at opening.
ASSETS['weapon-longsword'].hide_render=False;frame(ASSETS['weapon-longsword'])
for name,c in ASSETS.items():c.hide_viewport=(name!='weapon-longsword')
scene['asset_pipeline']='Original procedural meshes by SUPERDUNGEON; scripts/art/render_inventory.py'
scene['potion_appearance']='Shared bottle geometry; only liquid base color varies. Exact colors from config.POTION_LOOKS.'
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'superdungeon-inventory.blend'),compress=True)
ASSETS['weapon-longsword'].hide_render=True
for c in ASSETS.values():c.hide_viewport=False
for name in selected:
    if name not in ASSETS:continue
    c=ASSETS[name];c.hide_render=False;metadata[name].update(frame(c))
    scene.cycles.samples=512 if name.startswith('potion-') else 64
    scene.render.filepath=str(RENDERS/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    c.hide_render=True
    print('ASSET_READY '+name,flush=True)
(ART/'model-metadata.json').write_text(json.dumps({'generator':'scripts/art/render_inventory.py','blender':bpy.app.version_string,'seed':91304,'potionColors':POTION_COLORS,'assets':metadata},indent=2))
print('INVENTORY_RENDER_COMPLETE',flush=True)
