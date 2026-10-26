using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.RegularExpressions;

namespace LswbIpcV022 {
  public sealed class LocalAccount {
    public string Sid { get; set; }
    public string Name { get; set; }
    public bool Disabled { get; set; }
  }
  public sealed class SelectionIssue {
    public string Sid { get; set; }
    public string Reason { get; set; }
  }
  public sealed class AccountSelection {
    public LocalAccount[] Allowed { get; set; }
    public SelectionIssue[] Issues { get; set; }
  }
  public static class LocalAccounts {
    [StructLayout(LayoutKind.Sequential)] private struct User23 { public IntPtr Name,FullName,Comment; public uint Flags; public IntPtr Sid; }
    [DllImport("netapi32.dll", CharSet=CharSet.Unicode)] private static extern uint NetUserEnum(string server,uint level,uint filter,out IntPtr buffer,uint length,out uint read,out uint total,ref uint resume);
    [DllImport("netapi32.dll", CharSet=CharSet.Unicode)] private static extern uint NetUserGetInfo(string server,string user,uint level,out IntPtr buffer);
    [DllImport("netapi32.dll")] private static extern uint NetApiBufferFree(IntPtr buffer);
    [DllImport("netapi32.dll", CharSet=CharSet.Unicode)] private static extern uint DsRoleGetPrimaryDomainInformation(string server,int level,out IntPtr buffer);
    [DllImport("netapi32.dll")] private static extern void DsRoleFreeMemory(IntPtr buffer);
    public static bool IsLocalAccountRole(int role) { return role>=0 && role<=3; } // Never treat a DC's domain SAM as machine-local users.
    public static LocalAccount[] Read() {
      IntPtr role;uint code=DsRoleGetPrimaryDomainInformation(null,1,out role);
      if(code!=0)throw new Win32Exception((int)code);
      try { if(!IsLocalAccountRole(Marshal.ReadInt32(role)))throw new InvalidOperationException("Local account modes are unavailable on domain controllers."); }
      finally { DsRoleFreeMemory(role); }
      List<LocalAccount> users=new List<LocalAccount>();uint resume=0;
      do {
        IntPtr buffer;uint read,total;code=NetUserEnum(null,0,2,out buffer,0xffffffff,out read,out total,ref resume);
        if(code!=0&&code!=234)throw new Win32Exception((int)code);
        try {
          for(int i=0;i<read;i++) {
            string name=Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer,i*IntPtr.Size));IntPtr details;
            uint status=NetUserGetInfo(null,name,23,out details);
            if(status==2221)continue; // Account removed between the two read-only calls.
            if(status!=0)throw new Win32Exception((int)status);
            try {
              User23 user=(User23)Marshal.PtrToStructure(details,typeof(User23));
              string sid=new SecurityIdentifier(user.Sid).Value;
              if(!IsUserSid(sid))throw new InvalidOperationException("Unexpected non-user SID from the local SAM.");
              users.Add(new LocalAccount{Sid=sid,Name=Environment.MachineName+@"\"+Marshal.PtrToStringUni(user.Name),Disabled=(user.Flags&2)!=0});
              if(users.Count>10000)throw new InvalidOperationException("Local account catalog exceeds its limit.");
            } finally { NetApiBufferFree(details); }
          }
        } finally { if(buffer!=IntPtr.Zero)NetApiBufferFree(buffer); }
      }while(code==234);
      return users.ToArray();
    }
    public static bool IsUserSid(string value) {
      if(value==null||!Regex.IsMatch(value,@"\AS-1-5-21-\d+-\d+-\d+-\d+\z",RegexOptions.IgnoreCase))return false;
      try { return new SecurityIdentifier(value).AccountDomainSid!=null; }catch(ArgumentException){return false;}
    }
    public static AccountSelection Select(string mode,string[] selected,LocalAccount[] catalog) {
      List<LocalAccount> allowed=new List<LocalAccount>();List<SelectionIssue> issues=new List<SelectionIssue>();
      if(mode=="ownerOnly")return new AccountSelection{Allowed=allowed.ToArray(),Issues=issues.ToArray()};
      if(mode!="selectedUsers"&&mode!="allLocalUsers")throw new ArgumentException("Unknown IPC access mode.");
      Dictionary<string,LocalAccount> users=new Dictionary<string,LocalAccount>(StringComparer.OrdinalIgnoreCase);string domain=null;
      foreach(LocalAccount account in catalog) {
        if(!IsUserSid(account.Sid))throw new ArgumentException("Catalog includes a non-user SID.");
        string actual=new SecurityIdentifier(account.Sid).AccountDomainSid.Value;
        if(domain!=null&&domain!=actual)throw new ArgumentException("Catalog contains multiple account authorities.");domain=actual;users[account.Sid]=account;
      }
      if(mode=="allLocalUsers")allowed.AddRange(users.Values);
      else {
        if(selected==null||selected.Length>256)throw new ArgumentException("Select at most 256 local user SIDs.");
        HashSet<string> seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(string value in selected) {
          if(!IsUserSid(value)){issues.Add(new SelectionIssue{Sid=value,Reason="invalidSid"});continue;}
          string sid=new SecurityIdentifier(value).Value;if(!seen.Add(sid))continue;LocalAccount account;
          if(users.TryGetValue(sid,out account))allowed.Add(account);
          else issues.Add(new SelectionIssue{Sid=sid,Reason=domain!=null&&new SecurityIdentifier(sid).AccountDomainSid.Value==domain?"unavailableLocalUser":"notLocalAccount"});
        }
      }
      return new AccountSelection{Allowed=allowed.ToArray(),Issues=issues.ToArray()};
    }
  }
}
