// Reproducible synthetic neck/lumbar patient-language examples.
// Not a claim about population accuracy: expand with manually labeled,
// legally reusable real-world samples before declaring a measured error rate.
import {detectAll as light} from 'tinyld/light';
import {detectAll as normal} from 'tinyld';
import {detectAll as heavy} from 'tinyld/heavy';
import {detectSourceLanguage} from '../.test-build/source-language.js';

const samples=[
 ['en','My lower back hurts after sitting at my desk for a long time. I want to understand which exercises might help.'],
 ['en','I have neck stiffness every morning, and the discomfort sometimes spreads into my right shoulder after work.'],
 ['en','The physiotherapist suggested gentle movement, but I still have questions about recovery after a disc injury.'],
 ['en','My doctor explained the MRI results and asked me to record the pain before and after walking.'],
 ['zh-CN','我最近腰椎间盘突出，久坐以后右腿会发麻。医生建议我每天做轻度康复训练。'],
 ['zh-CN','颈椎疼痛持续了三个星期，晚上睡觉时肩膀也会不舒服，希望了解其他人的恢复经历。'],
 ['zh-CN','物理治疗之后症状有所缓解，但是坐办公室的时间一长，腰背部还是非常紧张。'],
 ['zh-CN','康复医生让我记录活动量，避免突然增加训练强度，并注意工作时的坐姿。'],
 ['zh-TW','我最近腰椎間盤突出，久坐之後右腿會發麻。醫師建議我每天做溫和的復健運動。'],
 ['zh-TW','頸椎疼痛已經持續三個星期，晚上睡覺時肩膀也會不舒服，想了解大家的恢復經驗。'],
 ['zh-TW','經過物理治療之後症狀有改善，不過坐辦公室太久，腰背還是非常緊繃。'],
 ['zh-TW','復健醫師提醒我要記錄活動量，避免突然增加訓練強度，也需要調整工作的姿勢。'],
 ['es','Tengo dolor en la zona lumbar después de estar sentado muchas horas y quiero compartir mi experiencia de recuperación.'],
 ['es','Desde hace tres semanas siento rigidez en el cuello y a veces tengo hormigueo en el brazo derecho.'],
 ['es','El fisioterapeuta me recomendó ejercicios suaves, pero todavía siento molestias al levantarme por la mañana.'],
 ['es','Mi médico revisó la resonancia y me pidió que anotara los cambios del dolor después de caminar.'],
 ['pt-BR','Sinto dor na região lombar depois de ficar sentado por várias horas e gostaria de compartilhar minha recuperação.'],
 ['pt-BR','Há três semanas tenho rigidez no pescoço e às vezes sinto formigamento no braço direito.'],
 ['pt-BR','A fisioterapeuta recomendou exercícios leves, mas ainda tenho desconforto quando acordo de manhã.'],
 ['pt-BR','O médico analisou a ressonância e pediu que eu anotasse a intensidade da dor depois de caminhar.'],
 ['de','Ich habe seit einigen Wochen Schmerzen im unteren Rücken, besonders wenn ich lange am Schreibtisch sitze.'],
 ['de','Meine Halswirbelsäule fühlt sich morgens steif an und manchmal kribbelt mein rechter Arm nach der Arbeit.'],
 ['de','Die Physiotherapeutin hat mir sanfte Übungen empfohlen, doch ich möchte meine Fortschritte besser dokumentieren.'],
 ['de','Mein Arzt hat die Untersuchung erklärt und mich gebeten, die Beschwerden beim Gehen regelmäßig aufzuschreiben.'],
 ['fr','Je ressens des douleurs dans le bas du dos après être resté assis longtemps et je voudrais parler de ma récupération.'],
 ['fr','Depuis plusieurs semaines, mon cou est raide le matin et j’ai parfois des fourmillements dans le bras droit.'],
 ['fr','Le kinésithérapeute m’a conseillé des exercices doux, mais je ressens encore une gêne lorsque je me lève.'],
 ['fr','Mon médecin a regardé les résultats de l’examen et m’a conseillé de noter les douleurs après la marche.'],
 ['ja','最近は長く座っていると腰が痛くなり、右脚がしびれることもあります。リハビリの体験を共有したいです。'],
 ['ja','朝起きると首が硬く感じられ、仕事の後には肩にも痛みが出ることがあります。'],
 ['ja','理学療法士から優しい運動を勧められましたが、回復の経過を毎日記録しています。'],
 ['ja','診察で検査結果を説明してもらい、歩いた後の痛みの変化を書き留めるようにしました。']
];
const norm=code=>code.toLowerCase().split('-')[0];
const systems=[['Light',light],['Standard',normal],['Heavy',heavy]];
const report=[];
for(const [name,fn] of systems){
 let correct=0;
 const mistakes=[];
 const t=performance.now();
 for(const [expected,source] of samples){
  const predicted=fn(source)?.[0]?.lang||'und';
  if(norm(expected)===norm(predicted))correct++;
  else mistakes.push({expected,predicted,preview:source.slice(0,60)});
 }
 const ms=(performance.now()-t)/samples.length;
 report.push({name,correct,total:samples.length,meanMs:Math.round(ms*1000)/1000,examples:mistakes.slice(0,4)});
}
let appCorrect=0,und=0;
const appMisses=[];
for(const [expected,source] of samples){
 const predicted=detectSourceLanguage(source);
 if(norm(predicted)===norm(expected))appCorrect++;
 else{if(predicted==='und')und++;appMisses.push({expected,predicted,preview:source.slice(0,60)});}
}
console.log('Synthetic spine-medical language detection comparison (NOT a population accuracy estimate):');
console.log(JSON.stringify({samples:samples.length,engines:report,forum:{correct:appCorrect,unresolved:und,misses:appMisses.slice(0,8)}},null,2));
// The benchmark is informational; no automatic Heavy superiority assertion.
// Production acceptance also requires Worker CPU/startup testing on Cloudflare.
