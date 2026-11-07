import {writeFileSync} from 'node:fs';
const locales=['en','zh-CN','es','pt-BR','de','fr','ja'];
const terms=[
['neck','body_part',['Neck & cervical spine','颈部与颈椎','Cuello y columna cervical','Pescoço e coluna cervical','Nacken und Halswirbelsäule','Cou et colonne cervicale','首・頸椎'],'neck pain|cervical|颈痛|脖子疼|颈椎|cervicales|cervicalgia|Nackenschmerzen|首の痛み'],
['lower-back','body_part',['Lower back & lumbar spine','腰部与腰椎','Zona lumbar','Lombar e coluna lombar','Unterer Rücken und Lendenwirbelsäule','Bas du dos et colonne lombaire','腰・腰椎'],'low back pain|lower back|lumbar|腰痛|腰疼|腰椎|lumbalgia|dor lombar|Lendenschmerzen|lombalgie|腰の痛み'],
['sciatica','symptom',['Sciatica','坐骨神经痛','Ciática','Ciática','Ischias','Sciatique','坐骨神経痛'],'sciatic|sciatica|坐骨神经|sciatique|Ischiasschmerzen|坐骨神経'],
['numbness','symptom',['Numbness & tingling','麻木与刺痛','Entumecimiento y hormigueo','Dormência e formigamento','Taubheit und Kribbeln','Engourdissement et picotements','しびれ・ピリピリ感'],'numbness|numb|tingling|麻木|手麻|腿麻|entumecimiento|hormigueo|dormência|formigamento|Taubheit|Kribbeln|engourdissement|picotement|しびれ'],
['sitting','symptom',['Pain when sitting','久坐疼痛','Dolor al sentarse','Dor ao sentar','Schmerzen beim Sitzen','Douleur en position assise','座ると痛い'],'sitting|sit for|久坐|坐着疼|sentarse|sentar|Sitzen|assise|座る'],
['morning-stiffness','symptom',['Morning stiffness','晨起僵硬','Rigidez matutina','Rigidez matinal','Morgensteifigkeit','Raideur matinale','朝のこわばり'],'morning stiffness|morning pain|晨僵|晨起疼|rigidez matutina|rigidez matinal|Morgensteifigkeit|raideur matinale|朝のこわばり'],
['arm-pain','symptom',['Arm pain','手臂疼痛','Dolor de brazo','Dor no braço','Armschmerzen','Douleur au bras','腕の痛み'],'arm pain|手臂疼|胳膊疼|dolor de brazo|dor no braço|Armschmerzen|douleur au bras|腕の痛み'],
['physical-therapy','treatment',['Physical therapy','物理治疗与康复训练','Fisioterapia','Fisioterapia','Physiotherapie','Kinésithérapie','理学療法'],'physical therapy|physiotherapy|康复训练|物理治疗|理疗|fisioterapia|Physiotherapie|kinésithérapie|理学療法'],
['surgery','treatment',['Surgery','手术','Cirugía','Cirurgia','Operation','Chirurgie','手術'],'surgery|surgical|手术|cirugía|cirurgia|Operation|chirurgie|手術'],
['medication','treatment',['Medication','药物治疗','Medicación','Medicação','Medikamente','Médicaments','薬物療法'],'medication|药物|medicación|medicação|Medikamente|médicaments|薬物'],
['patient-story','category',['Personal experience','个人经历','Experiencia personal','Experiência pessoal','Persönliche Erfahrung','Expérience personnelle','体験談'],'personal experience|patient story|个人经历|体験談']
];
const quote=s=>"'"+s.replaceAll("'","''")+"'";
let sql='-- Seven-language concept dictionary; editable taxonomy, independent from content.\n';
for(const [slug,type,labels,aliases] of terms){sql+=`INSERT INTO taxonomy_terms(id,term_type,slug) VALUES(${quote(slug)},${quote(type)},${quote(slug)});\n`;labels.forEach((label,i)=>{sql+=`INSERT INTO taxonomy_labels VALUES(${quote(slug)},${quote(locales[i])},${quote(label)});\n`;});
const words=[...new Set([...labels,...aliases.split('|')].map(s=>s.toLowerCase()))];for(const [i,a] of words.entries())sql+=`INSERT INTO taxonomy_aliases VALUES(${quote(slug+'-'+i)},${quote(slug)},'und',${quote(a)},${quote(a.normalize('NFKC'))});\n`;}
writeFileSync('migrations/v1/0002_taxonomy.sql',sql);
