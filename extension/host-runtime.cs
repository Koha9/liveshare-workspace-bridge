using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.ComponentModel;
using Microsoft.Win32.SafeHandles;

namespace LswbHostV020 {
  internal sealed class JobHandle : SafeHandleZeroOrMinusOneIsInvalid {
    public JobHandle() : base(true) {}
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    protected override bool ReleaseHandle() { return CloseHandle(handle); }
  }
  internal sealed class ProcessGroup : IDisposable {
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
      public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
      public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits {
      public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern JobHandle CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetInformationJobObject(JobHandle job, int informationClass, ref ExtendedLimits limits, int size);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool AssignProcessToJobObject(JobHandle job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateJobObject(JobHandle job, uint exitCode);
    private readonly JobHandle job; private bool closed;
    public ProcessGroup() {
      job=CreateJobObject(IntPtr.Zero,null);
      if(job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      ExtendedLimits limits=new ExtendedLimits(); limits.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE
      if(!SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(ExtendedLimits)))) { int error=Marshal.GetLastWin32Error(); job.Dispose(); throw new Win32Exception(error); }
    }
    public void Attach(Process process) { if(!AssignProcessToJobObject(job,process.Handle)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public void Kill() { if(!closed && !TerminateJobObject(job,1)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public void Dispose() { if(closed)return;closed=true;job.Dispose(); }
  }
  public static class Util {
    [StructLayout(LayoutKind.Explicit, Size=20)] private struct InputRecord {
      [FieldOffset(0)] public ushort Type;
      [FieldOffset(4)] public int KeyDown;
      [FieldOffset(8)] public ushort Repeat;
      [FieldOffset(14)] public ushort Character;
    }
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", EntryPoint="PeekConsoleInputW", SetLastError=true)] private static extern bool PeekConsoleInput(IntPtr handle, [Out] InputRecord[] buffer, uint length, out uint read);
    [DllImport("kernel32.dll", EntryPoint="ReadConsoleInputW", SetLastError=true)] private static extern bool ReadConsoleInput(IntPtr handle, [Out] InputRecord[] buffer, uint length, out uint read);
    public static string ReadPayload(int timeoutMs) {
      Stopwatch clock = Stopwatch.StartNew(); StringBuilder text = new StringBuilder();
      IntPtr input=GetStdHandle(-10); InputRecord[] records=new InputRecord[4096];
      while (clock.ElapsedMilliseconds < timeoutMs) {
        uint wait=WaitForSingleObject(input,50); if(wait==258)continue;if(wait==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error());
        uint available;if(!PeekConsoleInput(input,records,(uint)records.Length,out available))throw new Win32Exception(Marshal.GetLastWin32Error());
        if(available==0)continue;
        uint take=available;for(int i=0;i<(int)available;i++)if(records[i].Type==1&&records[i].KeyDown!=0&&records[i].Character==13){take=(uint)(i+1);break;}
        uint received;if(!ReadConsoleInput(input,records,take,out received))throw new Win32Exception(Marshal.GetLastWin32Error());
        for(int i=0;i<(int)received;i++){
          InputRecord key=records[i];if(key.Type!=1||key.KeyDown==0||key.Character==0)continue;
          char c=(char)key.Character;if(c=='\r')return text.ToString();
          if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='+'||c=='/'||c=='='))throw new InvalidOperationException("Unexpected shared-terminal payload input.");
          int count=Math.Max(1,(int)key.Repeat);if(text.Length+count>3000000)throw new InvalidOperationException("Shared-terminal payload exceeds limit.");text.Append(c,count);
        }
      }
      throw new TimeoutException("Shared-terminal payload input timed out.");
    }
    public static string Quote(string value) {
      StringBuilder b = new StringBuilder("\""); int slashes = 0;
      foreach (char c in value) {
        if (c == '\\') { slashes++; continue; }
        if (c == '"') { b.Append('\\', slashes * 2 + 1); b.Append(c); }
        else { b.Append('\\', slashes); b.Append(c); }
        slashes = 0;
      }
      b.Append('\\', slashes * 2); b.Append('"'); return b.ToString();
    }
    public static string Arguments(string[] args) {
      List<string> quoted = new List<string>(); foreach (string arg in args) quoted.Add(Quote(arg));
      return String.Join(" ", quoted.ToArray());
    }
    public static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    public static string HashFile(string filename) {
      using (FileStream s = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read))
      using (SHA256 sha = SHA256.Create()) { return Hex(sha.ComputeHash(s)); }
    }
  }
  public sealed class Job : IDisposable {
    private readonly Process process;
    private readonly ProcessGroup group;
    private readonly StringBuilder stdout = new StringBuilder(), stderr = new StringBuilder();
    private readonly object gate = new object();
    private readonly int limit;
    private readonly Task outTask, errTask;
    private readonly Timer timer;
    private bool outTruncated, errTruncated, cancelled, timedOut, disposed;
    public readonly DateTime StartedUtc = DateTime.UtcNow;
    public bool Finished { get { try { return process.HasExited; } catch { return true; } } }
    public Job(string executable, string[] args, string directory, int timeoutMs, int outputLimit) {
      limit = outputLimit;
      ProcessStartInfo info = new ProcessStartInfo(executable, Util.Arguments(args));
      info.WorkingDirectory = directory; info.UseShellExecute = false; info.CreateNoWindow = true;
      info.RedirectStandardOutput = true; info.RedirectStandardError = true; info.RedirectStandardInput = true;
      info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
      info.EnvironmentVariables["GIT_OPTIONAL_LOCKS"] = "0";
      group = new ProcessGroup(); process = new Process(); process.StartInfo = info;
      try { process.Start(); group.Attach(process); process.StandardInput.Close(); }
      catch { try { if(!process.HasExited)process.Kill(); } catch {} group.Dispose(); process.Dispose(); throw; }
      outTask = Task.Run(() => Pump(process.StandardOutput, false));
      errTask = Task.Run(() => Pump(process.StandardError, true));
      timer = new Timer(_ => Cancel(true), null, timeoutMs, Timeout.Infinite);
    }
    private void Pump(StreamReader reader, bool error) {
      char[] chars = new char[4096]; int n;
      try {
        while ((n = reader.Read(chars, 0, chars.Length)) > 0) {
          lock (gate) {
            StringBuilder target = error ? stderr : stdout;
            int keep = Math.Min(n, Math.Max(0, limit - target.Length));
            target.Append(chars, 0, keep);
            if (keep < n) { if (error) errTruncated = true; else outTruncated = true; }
          }
        }
      } catch (ObjectDisposedException) {} catch (IOException) {}
    }
    public void Cancel(bool timeout) {
      lock (gate) {
        if (disposed) return;
        try { if (process.HasExited) { group.Dispose(); return; } } catch { return; }
        if (timeout) timedOut = true; else cancelled = true;
        try { group.Kill(); } catch { try { process.Kill(); } catch {} }
      }
    }
    public Dictionary<string, object> Snapshot(int waitMs, int outOffset, int errOffset) {
      if (waitMs > 0) process.WaitForExit(waitMs);
      bool exited = process.HasExited;
      if (exited) { group.Dispose(); Task.WaitAll(new Task[] { outTask, errTask }, 1000); timer.Change(Timeout.Infinite, Timeout.Infinite); }
      lock (gate) {
        if (outOffset < 0 || outOffset > stdout.Length || errOffset < 0 || errOffset > stderr.Length) throw new ArgumentException("Invalid output cursor.");
        Dictionary<string, object> result = new Dictionary<string, object>();
        result["state"] = !exited ? "running" : timedOut ? "timed_out" : cancelled ? "cancelled" : "completed";
        result["exitCode"] = exited ? (object)process.ExitCode : null;
        result["stdout"] = stdout.ToString(outOffset, stdout.Length - outOffset);
        result["stderr"] = stderr.ToString(errOffset, stderr.Length - errOffset);
        result["stdoutOffset"] = stdout.Length; result["stderrOffset"] = stderr.Length;
        result["stdoutTruncated"] = outTruncated; result["stderrTruncated"] = errTruncated;
        result["processId"] = process.Id; return result;
      }
    }
    public void Dispose() {
      if (disposed) return; Cancel(false);
      lock (gate) { if (disposed) return; disposed = true; timer.Dispose(); group.Dispose(); process.Dispose(); }
    }
  }
  public sealed class Upload : IDisposable {
    private readonly FileStream stream;
    private readonly SHA256 hash = SHA256.Create();
    private readonly Timer timer;
    private readonly object gate = new object();
    private readonly long expected;
    private readonly int ttl;
    private int sequence; private bool closed;
    private string lastHash, finalDigest; private int lastSequence = -1;
    public Upload(long size, int lifetime) {
      if(size<0)throw new ArgumentException("Upload size must be nonnegative.");
      expected = size; ttl = lifetime;
      string filename = Path.Combine(Path.GetTempPath(), "lswb-upload-" + Guid.NewGuid().ToString("N") + ".tmp");
      stream = new FileStream(filename, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read, 65536, FileOptions.DeleteOnClose);
      timer = new Timer(_ => Dispose(), null, ttl, Timeout.Infinite);
    }
    private void Ensure() { if (closed) throw new InvalidOperationException("Transfer expired or closed."); timer.Change(ttl, Timeout.Infinite); }
    public bool Closed { get { lock(gate) { return closed; } } }
    public long Append(int seq, string base64) {
      byte[] data = Convert.FromBase64String(base64); if (data.Length > 65536) throw new ArgumentException("Chunk exceeds 65536 bytes.");
      using (SHA256 check = SHA256.Create()) {
        string digest = Util.Hex(check.ComputeHash(data));
        lock (gate) {
          Ensure();
          if (seq == lastSequence && digest == lastHash) return stream.Length;
          if (seq != sequence || finalDigest != null) throw new ArgumentException("Unexpected chunk sequence or finalized upload.");
          if (stream.Length + data.Length > expected) throw new ArgumentException("Transfer exceeds declared size.");
          stream.Write(data, 0, data.Length); hash.TransformBlock(data, 0, data.Length, data, 0);
          lastHash = digest; lastSequence = seq; sequence++; return stream.Length;
        }
      }
    }
    public string Commit(string destination, bool overwrite, string expectedCurrentHash, string expectedHash) {
      lock (gate) {
        Ensure(); if (stream.Length != expected) throw new InvalidOperationException("Transfer size does not match declaration.");
        if (finalDigest == null) { hash.TransformFinalBlock(new byte[0], 0, 0); finalDigest = Util.Hex(hash.Hash); }
        string digest = finalDigest;
        if (!String.Equals(digest, expectedHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Transfer SHA-256 mismatch.");
        if (File.Exists(destination)) {
          if (!overwrite) throw new IOException("Destination already exists.");
          if (String.IsNullOrEmpty(expectedCurrentHash) || !String.Equals(Util.HashFile(destination), expectedCurrentHash, StringComparison.OrdinalIgnoreCase)) throw new IOException("Destination changed or expectedCurrentSha256 is missing.");
        }
        string temporary = Path.Combine(Path.GetDirectoryName(destination), ".lswb-write-" + Guid.NewGuid().ToString("N") + ".tmp");
        try {
          stream.Position = 0;
          using (FileStream output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { stream.CopyTo(output); output.Flush(true); }
          if (File.Exists(destination)) File.Replace(temporary, destination, null); else File.Move(temporary, destination);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        Dispose(); return digest;
      }
    }
    public void Dispose() { lock (gate) { if (closed) return; closed = true; timer.Dispose(); stream.Dispose(); hash.Dispose(); } }
  }
  public sealed class Download : IDisposable {
    private readonly FileStream stream;
    private readonly SHA256 hash = SHA256.Create();
    private readonly Timer timer; private readonly int ttl;
    private readonly object gate = new object();
    private long offset; private bool closed;
    private long lastOffset = -1; private Dictionary<string, object> last;
    public readonly long Size;
    public bool Closed { get { lock(gate) { return closed; } } }
    public Download(string filename, int lifetime) {
      ttl = lifetime; stream = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read);
      Size = stream.Length; timer = new Timer(_ => Dispose(), null, ttl, Timeout.Infinite);
    }
    public Dictionary<string, object> Read(long start, int count) {
      lock (gate) {
        if (start == lastOffset && last != null) return last;
        if (closed) throw new InvalidOperationException("Transfer expired or closed.");
        if (start != offset || count < 1 || count > 65536) throw new ArgumentException("Invalid chunk offset/size.");
        timer.Change(ttl, Timeout.Infinite);
        byte[] bytes = new byte[(int)Math.Min(count, Size - offset)]; int read = 0;
        while (read < bytes.Length) { int n = stream.Read(bytes, read, bytes.Length - read); if (n == 0) throw new EndOfStreamException(); read += n; }
        hash.TransformBlock(bytes, 0, bytes.Length, bytes, 0); offset += bytes.Length;
        Dictionary<string, object> result = new Dictionary<string, object>();
        result["offset"] = start; result["nextOffset"] = offset; result["size"] = Size;
        result["base64"] = Convert.ToBase64String(bytes); result["complete"] = offset == Size;
        if (offset == Size) { hash.TransformFinalBlock(new byte[0], 0, 0); result["sha256"] = Util.Hex(hash.Hash); }
        lastOffset = start; last = result;
        if (offset == Size) Dispose(); return result;
      }
    }
    public void Dispose() { lock (gate) { if (closed) return; closed = true; timer.Dispose(); stream.Dispose(); hash.Dispose(); } }
  }
}
