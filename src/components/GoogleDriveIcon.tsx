/** Official Google Drive product icon, served locally without a third-party request. */
export default function GoogleDriveIcon({ size = 26 }: { size?: number }) {
  return (
    <img
      src="./google-drive.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
