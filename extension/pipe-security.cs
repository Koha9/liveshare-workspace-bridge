using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Collections.Generic;
using System.ComponentModel;
using System.Threading.Tasks;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace LswbIpcV022 {
  // An explicit, opt-in trust boundary, not a general local-users pipe.
  public sealed class LocalPipe : IDisposable {
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes {
      public int Length; public IntPtr Descriptor;
      [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maxInstances, uint outSize, uint inSize, uint timeout, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetNamedPipeClientSessionId(SafePipeHandle handle, out uint session);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetNamedPipeClientProcessId(SafePipeHandle handle, out uint process);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CancelIoEx(SafePipeHandle handle, IntPtr overlapped);
    public readonly NamedPipeServerStream Stream;
    public readonly LocalAccount[] AllowedUsers;
    public readonly SelectionIssue[] SelectionIssues;
    public readonly int SessionId;
    public readonly string Mode;
    public LocalPipe(string pipeName, string accessMode, string[] selectedUserSids) {
      if (!System.Text.RegularExpressions.Regex.IsMatch(pipeName, @"\Aliveshare-local-\d+-[a-f0-9-]+\z")) throw new ArgumentException("Invalid bridge pipe name.");
      Mode=accessMode;
      SessionId=Process.GetCurrentProcess().SessionId;
      SecurityIdentifier owner=WindowsIdentity.GetCurrent().User;
      PipeSecurity security=new PipeSecurity();
      security.SetAccessRuleProtection(true,false); security.SetOwner(owner);
      // Defense in depth: remote connections are also rejected by the pipe mode.
      security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid,null),PipeAccessRights.FullControl,AccessControlType.Deny));
      security.AddAccessRule(new PipeAccessRule(owner,PipeAccessRights.FullControl,AccessControlType.Allow));
      AccountSelection selection=LocalAccounts.Select(accessMode,selectedUserSids,accessMode=="ownerOnly"?new LocalAccount[0]:LocalAccounts.Read());
      AllowedUsers=selection.Allowed;SelectionIssues=selection.Issues;
      foreach (LocalAccount account in AllowedUsers) {
        SecurityIdentifier sid=new SecurityIdentifier(account.Sid);
        // libuv opens GENERIC_READ|GENERIC_WRITE. FILE_APPEND_DATA shares the
        // CreateNewInstance bit; a single persistent FIRST_PIPE_INSTANCE prevents
        // a trusted client from adding another server instance while we are live.
        PipeAccessRights rights=PipeAccessRights.ReadWrite|PipeAccessRights.Synchronize|PipeAccessRights.CreateNewInstance;
        security.AddAccessRule(new PipeAccessRule(sid,rights,AccessControlType.Allow));
      }
      byte[] descriptor=security.GetSecurityDescriptorBinaryForm();
      IntPtr memory=Marshal.AllocHGlobal(descriptor.Length);
      SafePipeHandle handle=null;
      try {
        Marshal.Copy(descriptor,0,memory,descriptor.Length);
        SecurityAttributes attributes=new SecurityAttributes(); attributes.Length=Marshal.SizeOf(typeof(SecurityAttributes)); attributes.Descriptor=memory; attributes.Inherit=false;
        // DUPLEX | OVERLAPPED | FIRST_PIPE_INSTANCE, BYTE | REJECT_REMOTE_CLIENTS.
        handle=CreateNamedPipe(@"\\.\pipe\"+pipeName,0x40080003,0x8,1,4096,4096,0,ref attributes);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        Stream=new NamedPipeServerStream(PipeDirection.InOut,true,false,handle);
      } catch { if(handle!=null)handle.Dispose();throw; }
      finally { Marshal.FreeHGlobal(memory); }
    }
    public bool ClientIsInSession() {
      uint session,process;
      if(!GetNamedPipeClientSessionId(Stream.SafePipeHandle,out session) || !GetNamedPipeClientProcessId(Stream.SafePipeHandle,out process)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return IsSessionAllowed(SessionId,session) && process!=0;
    }
    public static bool IsSessionAllowed(int serverSession,uint clientSession) { return serverSession>=0 && (uint)serverSession==clientSession; }
    public bool Drain(int timeoutMs) {
      // DisconnectNamedPipe discards unread output. Bound FlushFileBuffers so an
      // allowed but stalled client cannot hold the helper indefinitely.
      Task task=Task.Run(delegate { try { Stream.WaitForPipeDrain(); } catch(IOException) {} });
      return task.Wait(timeoutMs);
    }
    public static async Task<string> ReadFrameAsync(Stream stream,int limit) {
      // Bound bytes before JSON parsing, including a client that never sends LF.
      byte[] buffer=new byte[4096];
      using(MemoryStream frame=new MemoryStream()) {
        for(;;) {
          int count=await stream.ReadAsync(buffer,0,buffer.Length).ConfigureAwait(false);
          if(count==0) { if(frame.Length==0)return null;throw new InvalidDataException("Incomplete IPC frame."); }
          int end=Array.IndexOf<byte>(buffer,10,0,count),take=end<0?count:end;
          if(frame.Length+take>limit)throw new InvalidDataException("IPC frame exceeds limit.");
          frame.Write(buffer,0,take);
          if(end>=0)return new UTF8Encoding(false,true).GetString(frame.GetBuffer(),0,(int)frame.Length);
        }
      }
    }
    public void Disconnect() {
      CancelIoEx(Stream.SafePipeHandle,IntPtr.Zero);
      if(Stream.IsConnected)Stream.Disconnect();
    }
    public void Dispose() { Stream.Dispose(); }
  }
}
