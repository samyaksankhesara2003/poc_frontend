import axios from "axios";
import { useRef, useState } from "react";

const HomePage = () => {


    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const [text, setText] = useState("");
    const [isRecording, setIsRecording] = useState(false);

    const startRecording = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        mediaRecorderRef.current = new MediaRecorder(stream);

        mediaRecorderRef.current.ondataavailable = (e) => {
            chunksRef.current.push(e.data);
        };

        mediaRecorderRef.current.start();
        setIsRecording(true);

    };

    const stopRecording = () => {
        mediaRecorderRef.current.stop();
        setIsRecording(false);

        mediaRecorderRef.current.onstop = async () => {
            const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
            chunksRef.current = [];

            const formData = new FormData();
            formData.append("audio", audioBlob, "recording.webm");

            try {

                const res = await axios.post(
                    "http://localhost:3000/poc/upload",
                    formData,
                    {
                        headers: {
                            "Content-Type": "multipart/form-data"
                        }
                    }
                );
                setText(res.data.text);
            } catch (err) {
                console.error(err);
                alert("Transcription failed");
            }
        };
    };

    return (
        <div style={{ padding: "20px" }}>
            <h2>Voice to Text</h2>
            <button onClick={startRecording} disabled={isRecording}>Start</button>
            <button onClick={stopRecording} disabled={!isRecording}>Stop</button>

            <div style={{ marginTop: "20px", padding: "10px", border: "1px solid #ccc" }}>
                <strong>Transcription:</strong>
                <pre style={{ whiteSpace: "pre-wrap" }}>{text || "Click Start to begin..."}</pre>
            </div>
        </div>
    );
}
export default HomePage;