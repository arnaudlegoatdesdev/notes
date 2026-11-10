import type { VaultData } from './core/types';
export function createData(limitBytes = 1024 ** 3): VaultData {
  return { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), channels: [
    { id: crypto.randomUUID(), name: 'notes', description: 'Les petites choses à ne pas oublier.', icon: 'hash' },
    { id: crypto.randomUUID(), name: 'documents', description: 'Tout retrouver au même endroit.', icon: 'file' },
    { id: crypto.randomUUID(), name: 'idées', description: 'Une idée, même en passant.', icon: 'bookmark' },
    { id: crypto.randomUUID(), name: 'voyages', description: 'Pour les prochaines escapades.', icon: 'plane' },
  ], messages: [], preferences: { theme: 'slate', font: 'system', fontSize: 15, limitBytes } };
}
export function demoData(): VaultData {
  const data = createData(); const channelId=data.channels[0].id;
  const at=(days:number,hour:number,min:number)=>{const d=new Date();d.setDate(d.getDate()-days);d.setHours(hour,min,0,0);return d.toISOString()};
  const add=(text:string,days:number,hour:number,min:number,pinned=false)=>data.messages.push({id:crypto.randomUUID(),channelId,text,createdAt:at(days,hour,min),attachments:[],pinned});
  add('Un petit espace, rien qu’à moi.\nMes notes, mes fichiers, mes idées. Chaque chose dans son salon.',1,18,32,true);
  add('À garder sous la main\n\nCode du cadenas vélo : 4826\nTaille du filtre à café : 02\nNom de la plante du salon : pilea',1,18,34);
  add('Penser à scanner les documents pour le prochain voyage et les ranger dans le salon voyages.',0,9,12);
  add('Une idée pour ce week-end : partir prendre l’air, sans programme. 🌿',0,10,48);
  return data;
}
