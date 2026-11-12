import {useState} from "react";
import type {GoogleUser} from "../auth";
import {googlePicture} from "../google-picture";
export default function ProfileAvatar({user}: {user: GoogleUser}) {
  const [failed, setFailed] = useState("");
  const picture = googlePicture(user.picture);
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase();
  return picture && picture !== failed
    ? <img className="profile-picture" src={picture} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(picture)} />
    : <span className="profile-initials" aria-hidden="true">{initials}</span>;
}
