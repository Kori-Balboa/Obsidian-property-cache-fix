# Obsidian-property-cache-fix  
temporarly Performance fix for large Vaults in Obsidian via community Plugin  
this is ment for the Obsidian dev-Team only!  

Please note, i am not a programmer at all. The cause of this problem was found after giving everything else a try (Network, SMB share, windows, Ethernet settings,..)  
It took about 2 days to find the solution and with help of ai i made this little "plugin"  

Like you said its better to build these things at core level rather than as plugin.  
metadataTypeManager and "finished"-event are internal, so i could get a use of it. Instead Metadatacached.changed  

Tested circumstances:  

1-2min normal typing in a Markdown files      0x property refresh  
add property                                  1x full refresh(~200ms)  
change property value                         1x full refresh  
delete property                               1x full refresh  
delete last property of the same name         1x full refresh  
add same property to 2nd .md file             1x full refresh  
add new .md file                              no refresh  
add new .md file with property                1x full refresh  
change .md file name                          1x full refresh  
change .md file location within the vault     1x full refresh  
delete .md file with properties               1x full refresh  
delete .md file without property              no refresh  
change propertyvalues fast (5x within a secound     only one refresh isntead of 5  
propertytype editing (value, text, number,..)       functioning global  
turn plugin off while vault is open           as planed the 280ms spikes return  
turn plugin on while vault is open            as planed, smooth again  
restart obsidian                              works from start  
change .md file from vault via notepad+       1x full refresh   
command palette -> refresh global property cache       as planed 1x full refresh  





