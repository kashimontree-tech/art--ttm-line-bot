"use strict";
const fs=require("fs/promises"),os=require("os"),path=require("path");
const {execFile}=require("child_process"),{promisify}=require("util");
const run=promisify(execFile);

async function renderNarratedVideo(imageBytes,audioBytes,{ffmpegPath=require("ffmpeg-static")}={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"art-video-"));
  try {
    await fs.writeFile(path.join(dir,"image.png"),imageBytes);
    await fs.writeFile(path.join(dir,"voice.mp3"),audioBytes);
    const dest=path.join(dir,"video.mp4");
    await run(ffmpegPath,["-y","-hide_banner","-loglevel","error","-loop","1","-framerate","24","-i",path.join(dir,"image.png"),"-i",path.join(dir,"voice.mp3"),
      "-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v","libx264","-preset","ultrafast","-crf","24","-c:a","aac","-b:a","128k","-shortest","-movflags","+faststart","-threads","1","-filter_threads","1",dest],{timeout:180000,maxBuffer:1024*1024});
    const bytes=await fs.readFile(dest);
    if(bytes.length<1000||bytes.subarray(4,8).toString()!=="ftyp")throw Error("Invalid MP4 output");
    if(bytes.length>40*1024*1024)throw Error("Video exceeds the output size limit");
    return bytes;
  } finally {await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={renderNarratedVideo};
