/** Only OS plumbing is inherited. Credentials and Node injection options are never inherited. */
export function childEnvironment(source = process.env) {
  const allowed = new Set(['systemroot','windir','comspec','path','pathext','temp','tmp','localappdata','appdata','userprofile','programdata','programfiles','programfiles(x86)','commonprogramfiles','processor_architecture','number_of_processors','lang','lc_all']);
  return Object.fromEntries(Object.entries(source).filter(([key,value]) => allowed.has(key.toLowerCase()) && value !== undefined));
}
