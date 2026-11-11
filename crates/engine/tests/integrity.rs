//! Local HTTP fixtures exercise bytes on disk, not only range parser helpers.
use std::{fs, io::{Read, Write}, net::TcpListener, path::PathBuf, sync::{Arc, atomic::{AtomicBool, Ordering}}, thread, time::{Duration, SystemTime, UNIX_EPOCH}};
use swiftdl_engine::{Client, run, CancellationToken, Outcome, Progress, Request, SpeedLimiter, header::HeaderMap};

struct Fixture { url: String, data: Arc<Vec<u8>>, stop: Arc<AtomicBool>, worker: Option<thread::JoinHandle<()>> }
impl Fixture {
    fn new() -> Self {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url=format!("http://{}/file.bin",listener.local_addr().unwrap());
        let data=Arc::new((0..262144).map(|i|(i%251)as u8).collect::<Vec<_>>());
        let stop=Arc::new(AtomicBool::new(false));let running=stop.clone();let payload=data.clone();
        let worker=thread::spawn(move||while !running.load(Ordering::Relaxed){
            let Ok((mut stream,_))=listener.accept() else {thread::sleep(Duration::from_millis(5));continue;};
            let data=payload.clone();thread::spawn(move||{
                // Winsock can inherit nonblocking mode from the listener.
                // A request may not have arrived yet; a WouldBlock must not
                // be treated as EOF and reset the client's connection.
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut request_bytes=Vec::new();let mut buf=[0u8;2048];
                while !request_bytes.windows(4).any(|b|b==b"\r\n\r\n") {let n=stream.read(&mut buf).unwrap_or(0);if n==0{return;}request_bytes.extend_from_slice(&buf[..n]);}
                let text=String::from_utf8_lossy(&request_bytes).to_lowercase();
                let range=text.lines().find_map(|l|l.strip_prefix("range: bytes="));
                let (a,b)=range.and_then(|s|s.split_once('-')).map(|(a,b)|(a.parse::<usize>().unwrap(),b.parse::<usize>().unwrap())).unwrap_or((0,data.len()-1));
                let header=format!("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {a}-{b}/{}\r\nContent-Length: {}\r\nETag: \"fixture-v1\"\r\nConnection: close\r\n\r\n",data.len(),b-a+1);
                let _=stream.write_all(header.as_bytes());let _=stream.write_all(&data[a..=b]);
            });
        });
        Self{url,data,stop,worker:Some(worker)}
    }
}
impl Drop for Fixture { fn drop(&mut self){self.stop.store(true,Ordering::Relaxed);if let Some(w)=self.worker.take(){w.join().unwrap();}} }
fn folder()->PathBuf {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let p=std::env::temp_dir().join(format!("baadash-integrity-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),NEXT.fetch_add(1,Ordering::Relaxed)));
    fs::create_dir(&p).unwrap();p
}
async fn download(f:&Fixture,dest:PathBuf)->anyhow::Result<Outcome>{
    // These byte-integrity fixtures only talk to loopback. Do not let the
    // runner's proxy discovery or proxy settings affect local test traffic.
    let client=Client::builder().no_proxy().http1_only().build()?;
    run(&client,&Request{url:f.url.clone(),dest,connections:4,headers:HeaderMap::new(),restart:false},Arc::new(Progress::default()),CancellationToken::new(),Arc::new(SpeedLimiter::new(0))).await
}
#[tokio::test]
async fn truncated_resume_file_is_restarted_and_bytes_match(){
    let f=Fixture::new();let dir=folder();let dest=dir.join("file.bin");
    fs::write(dir.join("file.bin.part"),b"truncated").unwrap();
    fs::write(dir.join("file.bin.swiftdl"),serde_json::json!({"url":f.url,"size":f.data.len(),"etag":"\"fixture-v1\"","last_modified":null,"segments":[[1000,f.data.len()]]}).to_string()).unwrap();
    assert_eq!(download(&f,dest.clone()).await.unwrap(),Outcome::Completed);assert_eq!(fs::read(&dest).unwrap(),*f.data);fs::remove_dir_all(dir).unwrap();
}
#[tokio::test]
async fn existing_destination_is_preserved(){
    let f=Fixture::new();let dir=folder();let dest=dir.join("file.bin");fs::write(&dest,b"keep me").unwrap();
    let error=download(&f,dest.clone()).await.unwrap_err();
    assert!(format!("{error:#}").contains("目标文件已经存在"), "{error:#}");
    assert_eq!(fs::read(&dest).unwrap(),b"keep me");assert!(dir.join("file.bin.part").exists());fs::remove_dir_all(dir).unwrap();
}
