using System;
using System.Runtime.InteropServices;
using System.Text;

class Program {
    [ComImport]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    public class FileOpenDialogRCW {}

    [ComImport]
    [Guid("d57c7288-d4ad-4768-be02-9d969532d960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid();
        void ClearClientData();
        void SetFilter();
        void GetResults(out IntPtr ppenum);
        void GetSelectedItems(out IntPtr ppsai);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem {
        void BindToHandler();
        void GetParent();
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [STAThread]
    static int Main(string[] args) {
        try {
            string title = args.Length > 0 ? args[0] : "选择工作区目录";
            var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
            try {
                uint options;
                dialog.GetOptions(out options);
                // FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40
                dialog.SetOptions(options | 0x00000020 | 0x00000040);
                dialog.SetTitle(title);
                dialog.SetOkButtonLabel("选择此文件夹");

                IntPtr parent = GetForegroundWindow();
                int hr = dialog.Show(parent);
                if (hr == 0) {
                    IShellItem item;
                    dialog.GetResult(out item);
                    string path;
                    item.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                    if (!string.IsNullOrEmpty(path)) {
                        try { Console.OutputEncoding = Encoding.UTF8; } catch {}
                        Console.Write(path);
                        return 0;
                    }
                }
                return 1;
            } finally {
                Marshal.ReleaseComObject(dialog);
            }
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 2;
        }
    }
}
