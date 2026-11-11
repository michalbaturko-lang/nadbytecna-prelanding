// Use native summary clicks to reach controls in the compact UI during local tests.
export async function revealControl(control){
 await control.waitFor({state:"attached"});
 for(let depth=0;depth<5;depth++){
  const details=control.locator('xpath=ancestor::details[not(@open)]');
  if(!await details.count())return;
  await details.first().locator(':scope > summary').click();
 }
 throw new Error('test_control_nesting');
}
export async function revealButton(page,name){await revealControl(page.getByRole('button',{name,exact:true,includeHidden:true}));}
