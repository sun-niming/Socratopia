(()=>{
  const root=globalThis;
  const ADAPTER_VERSION="markdown-math-speech-adapter-v1";
  const DEFAULT_LOCALE="zh-Hans";
  const DEFAULT_STYLE="concise";
  const LIMITS=Object.freeze({maxInputChars:24000,maxTextChars:8192,maxLatexChars:4096,maxSegments:32,maxRequestChars:120000,maxContextChars:512,timeoutMs:8000});
  const NARRATION_LABEL=/^(?:\u65c1\u767d|\u753b\u5916\u97f3|\u5185\u5fc3\u72ec\u767d|\u52a8\u4f5c\u63cf\u5199|\u573a\u666f\u63cf\u5199|Narrator|Narration|Voice[- ]?over|Inner monologue|Action|Scene description)\s*[:\uff1a]/i;

  function isEscapedAt(value,index){let count=0;for(let i=index-1;i>=0&&value[i]==="\\";i--)count++;return count%2===1}
  function lineEndAt(value,index){const end=value.indexOf("\n",index);return end<0?value.length:end}
  function findUnescaped(value,token,from,limit){let index=value.indexOf(token,from);while(index>=0&&(typeof limit!=="number"||index<limit)){if(!isEscapedAt(value,index))return index;index=value.indexOf(token,index+1)}return-1}
  function readFenceAt(value,index){
    if(index>0&&value[index-1]!=="\n")return null;
    const lineEnd=lineEndAt(value,index),line=value.slice(index,lineEnd).replace(/\r$/,""),match=line.match(/^ {0,3}(`{3,}|~{3,})[^\r\n]*$/);
    if(!match)return null;
    const marker=match[1],markerChar=marker[0],closePattern=new RegExp("^ {0,3}"+markerChar+"{"+marker.length+",}[ \\t]*$");
    let cursor=lineEnd<value.length?lineEnd+1:value.length,end=value.length,closed=false;
    while(cursor<=value.length){
      const nextLineEnd=lineEndAt(value,cursor),candidate=value.slice(cursor,nextLineEnd).replace(/\r$/,""),hasNewline=nextLineEnd<value.length;
      if(closePattern.test(candidate)){end=hasNewline?nextLineEnd+1:nextLineEnd;closed=true;break}
      if(!hasNewline)break;
      cursor=nextLineEnd+1;
    }
    return{kind:"protected",protectedKind:"fenced-code",tts:false,skipReason:closed?"fenced-code":"unclosed-fenced-code",end:end};
  }
  function readInlineCodeAt(value,index){
    const match=value.slice(index).match(/^`+/);if(!match)return null;
    const marker=match[0],close=value.indexOf(marker,index+marker.length),lineEnd=lineEndAt(value,index),contentEnd=close>=0&&close<=lineEnd?close:lineEnd;
    return{kind:"protected",protectedKind:"inline-code",tts:true,ttsValue:value.slice(index+marker.length,contentEnd),end:close>=0&&close<=lineEnd?close+marker.length:lineEnd};
  }
  function findClosingBracket(value,start){
    let depth=0;
    for(let index=start;index<value.length;index++){
      if(value[index]==="\\"){index++;continue}
      if(value[index]==="[")depth++;
      else if(value[index]==="]"){depth--;if(depth===0)return index}
    }
    return-1;
  }
  function readLinkAt(value,index){
    const image=value.startsWith("![",index),labelStart=index+(image?2:1);
    if(!image&&value[index]!=="[")return null;
    const labelEnd=findClosingBracket(value,labelStart-1);if(labelEnd<0||value[labelEnd+1]!=="(")return null;
    let cursor=labelEnd+2;
    while(cursor<value.length&&/[ \t\r\n]/.test(value[cursor]))cursor++;
    let close=-1;
    if(value[cursor]==="<"){
      const angleEnd=findUnescaped(value,">",cursor+1);if(angleEnd<0)return null;
      cursor=angleEnd+1;while(cursor<value.length&&/[ \t\r\n]/.test(value[cursor]))cursor++;
      if(value[cursor]!==")")return null;close=cursor;
    }else{
      let depth=0;
      for(let position=cursor;position<value.length;position++){
        if(value[position]==="\\"){position++;continue}
        if(value[position]==="(")depth++;
        else if(value[position]===")"){
          if(depth===0){close=position;break}
          depth--;
        }
      }
      if(close<0)return null;
    }
    return{kind:"protected",protectedKind:image?"markdown-image":"markdown-link",tts:!image,ttsValue:image?"":value.slice(labelStart,labelEnd),end:close+1};
  }
  function readUrlAt(value,index){
    const match=value.slice(index).match(/^(?:https?:\/\/|www\.)[^\s<>\n]+/i);return match?{kind:"protected",protectedKind:"url",tts:true,ttsValue:match[0],end:index+match[0].length}:null;
  }
  function readAutolinkAt(value,index){
    const match=value.slice(index).match(/^<https?:\/\/[^>\n]+>/i);return match?{kind:"protected",protectedKind:"url",tts:true,ttsValue:match[0].slice(1,-1),end:index+match[0].length}:null;
  }
  // 【表格播报 v1】: a markdown table is announced instead of read cell by cell.  The reading
  // budget comes from the table's own shape — cells, not rows, because a wide table costs more
  // eye travel than a tall one — and is quantised into buckets so the spoken number and the real
  // pause can never disagree.  Nothing inside the table reaches /api/math-speech: the whole block
  // is one protected segment, so its formulas never enter a request body.
  const TABLE_DELIMITER_CELL=/^\s*:?-{2,}:?\s*$/;
  const TABLE_SECONDS_BY_CELLS=[{maxCells:6,seconds:0},{maxCells:12,seconds:10},{maxCells:24,seconds:15},{maxCells:Infinity,seconds:20}];
  const TABLE_SECONDS_CN={10:"\u5341",15:"\u5341\u4e94",20:"\u4e8c\u5341"};
  function splitTableRow(line){
    let text=line.trim();
    if(text[0]==="|")text=text.slice(1);
    if(text[text.length-1]==="|"&&text[text.length-2]!=="\\")text=text.slice(0,-1);
    const cells=[];let current="",escaped=false;
    for(const character of text){
      if(escaped){current+=character;escaped=false;continue}
      if(character==="\\"){current+=character;escaped=true;continue}
      if(character==="|"){cells.push(current);current="";continue}
      current+=character;
    }
    cells.push(current);
    return cells;
  }
  function readTableAt(value,index){
    if(index>0&&value[index-1]!=="\n")return null;
    const headerEnd=lineEndAt(value,index);
    if(headerEnd>=value.length)return null;
    const header=value.slice(index,headerEnd).replace(/\r$/,"");
    if(header.indexOf("|")<0||/^ {0,3}(`{3,}|~{3,})/.test(header))return null;
    const headerCells=splitTableRow(header);
    if(headerCells.length<2)return null;
    const delimiterStart=headerEnd+1,delimiterEnd=lineEndAt(value,delimiterStart);
    const delimiter=value.slice(delimiterStart,delimiterEnd).replace(/\r$/,"");
    if(delimiter.indexOf("|")<0)return null;
    const delimiterCells=splitTableRow(delimiter);
    if(delimiterCells.length!==headerCells.length)return null;
    if(!delimiterCells.every(function(cell){return TABLE_DELIMITER_CELL.test(cell)}))return null;
    let cursor=delimiterEnd<value.length?delimiterEnd+1:value.length,end=cursor,rows=1,columns=headerCells.length;
    while(cursor<value.length){
      const nextEnd=lineEndAt(value,cursor),line=value.slice(cursor,nextEnd).replace(/\r$/,"");
      if(!line.trim()||line.indexOf("|")<0)break;
      if(/^ {0,3}(`{3,}|~{3,})/.test(line))break;
      const cells=splitTableRow(line);
      if(cells.length<2)break;
      rows++;if(cells.length>columns)columns=cells.length;
      end=nextEnd<value.length?nextEnd+1:nextEnd;cursor=end;
    }
    return{kind:"table",protectedKind:"markdown-table",tts:true,table:{rows:rows,cols:columns,cells:rows*columns},end:end};
  }
  function tableReadingSeconds(table,repeatIndex){
    let seconds=20;
    for(const bucket of TABLE_SECONDS_BY_CELLS){if(table.cells<=bucket.maxCells){seconds=bucket.seconds;break}}
    if(seconds>0&&table.cols>=5&&seconds<20)seconds=seconds===10?15:20;
    if(seconds>0&&repeatIndex>0)seconds=Math.max(10,seconds-5);
    return seconds;
  }
  function precedingLineTail(value,start){
    let cursor=start;
    while(cursor>0&&/\s/.test(value[cursor-1]))cursor--;
    const lineStart=value.lastIndexOf("\n",Math.max(0,cursor-1))+1;
    return value.slice(lineStart,cursor).slice(-24);
  }
  function tableAnnouncement(source,start,table,repeatIndex){
    const seconds=tableReadingSeconds(table,repeatIndex);
    if(seconds<=0)return{speech:"",pauseMs:0,seconds:0};
    // A lead-in that already named the table ("如下表所示：") must not be answered with
    // "先看这张表" again; the sentence shrinks to the time alone.
    const alreadyNamed=/(?:\u8868|\u5982\u4e0b)/.test(precedingLineTail(source,start));
    const number=TABLE_SECONDS_CN[seconds]||String(seconds);
    return{speech:alreadyNamed?"\u7ed9\u4f60"+number+"\u79d2\u3002":"\u7ed9\u4f60"+number+"\u79d2\uff0c\u5148\u770b\u8fd9\u5f20\u8868\u3002",pauseMs:seconds*1000,seconds:seconds};
  }
  function findSingleDollar(value,from,limit){
    let index=value.indexOf("$",from);
    while(index>=0&&index<limit){if(!isEscapedAt(value,index)&&value[index-1]!=="$"&&value[index+1]!=="$")return index;index=value.indexOf("$",index+1)}
    return-1;
  }
  function validInlineMath(value,open,close,inner){
    const trimmed=inner.trim();if(!trimmed||/[\r\n]/.test(inner))return false;
    const after=value[close+1]||"",before=value[open-1]||"";
    if(/^[0-9]/.test(trimmed)&&/[\p{L}\p{N}]/u.test(after))return false;
    if(/^\d+(?:[.,]\d+)?$/.test(trimmed)&&/[\p{L}\p{N}]/u.test(before))return false;
    return true;
  }
  function readMathAt(value,index){
    if(value[index]==="$"&&!isEscapedAt(value,index)){
      if(value.startsWith("$$",index)){
        const close=findUnescaped(value,"$$",index+2);
        if(close<0)return{kind:"protected",protectedKind:"unclosed-math",tts:true,ttsValue:value.slice(index),end:value.length};
        const inner=value.slice(index+2,close);if(!inner.trim())return{kind:"protected",protectedKind:"unmatched-math",tts:true,ttsValue:value.slice(index,close+2),end:close+2};
        return{kind:"math",delimiter:"$$",block:true,latex:inner,end:close+2};
      }
      if(value[index+1]==="$")return null;
      const limit=lineEndAt(value,index),close=findSingleDollar(value,index+1,limit);
      if(close<0)return{kind:"protected",protectedKind:"unclosed-math",tts:true,ttsValue:value.slice(index,limit),end:limit};
      const inner=value.slice(index+1,close);if(!validInlineMath(value,index,close,inner))return{kind:"protected",protectedKind:"unmatched-math",tts:true,ttsValue:value.slice(index,close+1),end:close+1};
      return{kind:"math",delimiter:"$",block:false,latex:inner,end:close+1};
    }
    for(const item of[{open:"\\[",close:"\\]",block:true},{open:"\\(",close:"\\)",block:false}]){
      if(!value.startsWith(item.open,index)||isEscapedAt(value,index))continue;
      const close=findUnescaped(value,item.close,index+item.open.length);
      if(close<0)return{kind:"protected",protectedKind:"unclosed-math",tts:true,ttsValue:value.slice(index),end:value.length};
      const inner=value.slice(index+item.open.length,close);if(!inner.trim())return{kind:"protected",protectedKind:"unmatched-math",tts:true,ttsValue:value.slice(index,close+item.close.length),end:close+item.close.length};
      return{kind:"math",delimiter:item.open+"..."+item.close,block:item.block,latex:inner,end:close+item.close.length};
    }
    return null;
  }
  function appendText(segments,value,start,end,extra){
    if(!value)return;const segment={type:"text",value:value,source:value,start:start,end:end,tts:true};if(extra)Object.assign(segment,extra);segments.push(segment);
  }
  function isWrappedStage(text,marker){
    if(text.length<3||text[0]!==marker||text[text.length-1]!==marker||text[1]===marker||text[text.length-2]===marker)return false;
    const inner=text.slice(1,-1);if(!inner.trim())return false;
    // Nested emphasis inside the span is the normal way to stress a word in a stage direction
    // ("*宵宫把纸条转过来，指尖点在那个 **else** 上。*").  A doubled marker belongs to the inner
    // text, so only an odd bare marker would end the span before the line does.
    let bare=0;
    for(let index=0;index<inner.length;index++){
      const character=inner[index];
      if(character!==marker||isEscapedAt(inner,index))continue;
      if(character===inner[index+1]||character===inner[index-1])continue;
      bare++;
    }
    return bare%2===0;
  }
  function narrationReason(value,index){
    const start=value.lastIndexOf("\n",Math.max(0,index-1))+1,end=lineEndAt(value,index),line=value.slice(start,end).trim();
    if(!line)return null;
    if(NARRATION_LABEL.test(line))return"narration-whitelist-prefix";
    if(isWrappedStage(line,"*")||isWrappedStage(line,"_"))return"narration-whitelist-stage-direction";
    return null;
  }
  function annotateSegments(segments,value){
    const expanded=[];
    segments.forEach(function(segment){
      if(segment.type!=="text"||segment.tts===false||segment.protected||segment.value.indexOf("\n")<0){expanded.push(segment);return}
      let offset=0;
      while(offset<segment.value.length){
        const relativeEnd=segment.value.indexOf("\n",offset),end=relativeEnd<0?segment.value.length:relativeEnd+1;
        expanded.push(Object.assign({},segment,{value:segment.value.slice(offset,end),source:segment.source.slice(offset,end),start:segment.start+offset,end:segment.start+end,ttsValue:void 0}));offset=end;
      }
    });
    return expanded.map(function(segment,index){
      const copy=Object.assign({},segment);copy.index=index;
      if(copy.tts!==false){const reason=narrationReason(value,copy.start);if(reason){copy.tts=false;copy.skipReason=reason}}
      return copy;
    });
  }
  function parseMarkdownMath(input){
    if(typeof input!=="string")return{ok:false,version:ADAPTER_VERSION,reason:"invalid-input",segments:[],text:"",mathCount:0};
    if(input.length>LIMITS.maxInputChars)return{ok:false,version:ADAPTER_VERSION,reason:"input-too-long",segments:[{type:"text",value:input,source:input,start:0,end:input.length,tts:true,index:0}],text:sanitizeOverflow(input),mathCount:0};
    const segments=[],length=input.length;let cursor=0,index=0,tableCount=0;
    while(index<length){
      let token=readFenceAt(input,index);
      if(!token&&input[index]==="`")token=readInlineCodeAt(input,index);
      if(!token&&(input[index]==="["||(input[index]==="!"&&input[index+1]==="[")))token=readLinkAt(input,index);
      if(!token&&input[index]==="<")token=readAutolinkAt(input,index);
      if(!token&&(input.startsWith("http://",index)||input.startsWith("https://",index)||input.startsWith("www.",index)))token=readUrlAt(input,index);
      // A table has to win over inline math: the first cell of a real table is often a formula,
      // and a math match at the line start would hide the header/delimiter pair from this reader.
      if(!token)token=readTableAt(input,index);
      if(!token)token=readMathAt(input,index);
      if(!token){index++;continue}
      if(index>cursor)appendText(segments,input.slice(cursor,index),cursor,index);
      const raw=input.slice(index,token.end);
      if(token.kind==="math")segments.push({type:"math",latex:token.latex,source:raw,delimiter:token.delimiter,block:token.block,start:index,end:token.end,tts:true});
      else if(token.kind==="table"){
        const announcement=tableAnnouncement(input,index,token.table,tableCount++);
        appendText(segments,raw,index,token.end,{protected:token.protectedKind,tts:true,ttsValue:raw,table:token.table,tableSpeech:announcement.speech,tablePauseMs:announcement.pauseMs});
      }
      else appendText(segments,raw,index,token.end,{protected:token.protectedKind,tts:token.tts!==false,ttsValue:typeof token.ttsValue==="string"?token.ttsValue:raw,skipReason:token.skipReason});
      index=token.end;cursor=index;
    }
    if(cursor<length)appendText(segments,input.slice(cursor),cursor,length);
    const annotated=annotateSegments(segments,input),mathCount=annotated.filter(segment=>segment.type==="math").length;
    return{ok:true,version:ADAPTER_VERSION,segments:annotated,text:input,mathCount:mathCount};
  }
  function cleanMarkdownText(value){
    let text=String(value||"");
    text=text.replace(/\\([\\`*_[\]{}()#+.!$|>~-])/g,"$1");
    text=text.replace(/(^|\n)\s{0,3}#{1,6}\s+/g,"$1");
    text=text.replace(/\*\*([^*\n]+)\*\*/g,"$1").replace(/__([^_\n]+)__/g,"$1");
    text=text.replace(/\*([^*\n]+)\*/g,"$1").replace(/_([^_\n]+)_/g,"$1");
    text=text.replace(/(^|\n)\s*>\s?/g,"$1");
    return text.replace(/[ \t]{2,}/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n");
  }
  function sanitizeOverflow(value){
    return cleanMarkdownText(String(value).replace(/```[\s\S]*?```/g,"").replace(/!\[[^\]]*\]\([^)]+\)/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1")).replace(/\n{3,}/g,"\n\n").trim();
  }
  function safeMathFallback(latex){
    const text=String(latex||"").replace(/\\([A-Za-z]+)/g," $1 ").replace(/\\([{}\[\]()])/g," $1 ").replace(/[{}]/g," ").replace(/\s+/g," ").trim();
    return text||"\u6570\u5b66\u516c\u5f0f";
  }
  function normalizeOptions(options){
    const value=options&&typeof options==="object"?options:{};
    let locale=typeof value.locale==="string"&&value.locale?value.locale:DEFAULT_LOCALE;
    if(locale==="zh"||locale==="zh-CN"||locale==="zh-Hans-CN")locale=DEFAULT_LOCALE;
    const style=value.style==="detailed"||value.style==="structural"?value.style:DEFAULT_STYLE;
    const timeout=Number(value.timeoutMs);const timeoutMs=Number.isFinite(timeout)&&timeout>=500?Math.min(Math.floor(timeout),15000):LIMITS.timeoutMs;
    return{locale:locale,style:style,timeoutMs:timeoutMs,signal:value.signal,context:value.context&&typeof value.context==="object"?value.context:{}};
  }
  function copyContext(value){
    const result={};if(!value||typeof value!=="object")return result;
    for(const key of["domainHints","symbolFacts","precedingText","currentSentence","intent"]){try{if(Object.prototype.hasOwnProperty.call(value,key))result[key]=value[key]}catch(error){}}
    return result;
  }
  function clipContext(value){return typeof value==="string"?value.slice(Math.max(0,value.length-LIMITS.maxContextChars),value.length):""}
  function sentenceContext(value,start,end){
    let left=start,right=end;
    for(let index=start-1;index>=0;index--){if(/[\u3002\uff01\uff1f!?]/.test(value[index])){left=index+1;break}if(value[index]==="\n"&&value[index-1]==="\n"){left=index+1;break}}
    for(let index=end;index<value.length;index++){if(/[\u3002\uff01\uff1f!?]/.test(value[index])){right=index+1;break}if(value[index]==="\n"&&value[index+1]==="\n"){right=index;break}}
    return clipContext(value.slice(left,right).trim());
  }
  function paragraphPrecedingText(value,start){
    const boundary=value.lastIndexOf("\n\n",Math.max(0,start-1));return clipContext(value.slice(boundary<0?0:boundary+2,start).trim());
  }
  function contextFor(segment,source,options){
    const context=copyContext(options.context);
    if(typeof context.currentSentence!=="string"||!context.currentSentence.trim())context.currentSentence=sentenceContext(source,segment.start,segment.end);else context.currentSentence=clipContext(context.currentSentence);
    if(typeof context.precedingText!=="string"||!context.precedingText.trim())context.precedingText=paragraphPrecedingText(source,segment.start);else context.precedingText=clipContext(context.precedingText);
    return context;
  }
  function requestSegments(parsed,source,options){
    const segments=[],map=[],localStates=[];let limitReason=null;
    parsed.segments.forEach(function(segment,index){
      if(segment.tts===false||segment.table)return;
      if(segment.type==="math"){
        if(segment.latex.length>LIMITS.maxLatexChars){localStates[index]={ok:false,speech:safeMathFallback(segment.latex),reason:"formula-too-long"};limitReason=limitReason||"formula-too-long";return}
        const responseIndex=segments.length;segments.push({type:"math",latex:segment.latex,locale:options.locale,style:options.style,context:contextFor(segment,source,options)});map.push({parsedIndex:index,responseIndex:responseIndex});return;
      }
      const value=cleanMarkdownText(typeof segment.ttsValue==="string"?segment.ttsValue:segment.value);if(!value)return;
      let offset=0;
      while(offset<value.length){
        const last=segments[segments.length-1];
        if(last&&last.type==="text"&&last.value.length<LIMITS.maxTextChars){const amount=Math.min(LIMITS.maxTextChars-last.value.length,value.length-offset);last.value+=value.slice(offset,offset+amount);offset+=amount}else{const part=value.slice(offset,offset+LIMITS.maxTextChars);segments.push({type:"text",value:part});offset+=part.length}
      }
    });
    return{segments:segments,map:map,localStates:localStates,limitReason:limitReason};
  }
  function assemble(parsed,mathStates,globalFallback){
    const outputSegments=[],parts=[],diagnostics={fallbackReason:globalFallback||null,convertedMath:0,fallbackMath:0,tables:0,skipped:[]};
    let pauseAfterMs=0;
    parsed.segments.forEach(function(segment,index){
      const copy=Object.assign({},segment);delete copy.start;delete copy.end;
      if(segment.tableSpeech!==void 0){
        // A table is announced, never read out.  Its reading budget rides on the result so the
        // page can hold the next fragment back for exactly the announced number of seconds.
        copy.speech=segment.tableSpeech;copy.pauseAfterMs=segment.tablePauseMs||0;
        pauseAfterMs=Math.max(pauseAfterMs,copy.pauseAfterMs);
        if(copy.speech)diagnostics.tables++;
        parts.push(copy.speech);outputSegments.push(copy);return;
      }
      if(segment.tts===false){copy.speech="";diagnostics.skipped.push({index:index,reason:segment.skipReason||"tts-skipped"});outputSegments.push(copy);return}
      if(segment.type==="math"){
        const state=mathStates[index]||{ok:false,speech:safeMathFallback(segment.latex),reason:globalFallback||"conversion-failed"};
        const speech=state.ok&&typeof state.speech==="string"&&state.speech.trim()?state.speech.trim():safeMathFallback(segment.latex);
        copy.ok=state.ok===true;copy.speech=speech;copy.fallback=!copy.ok;copy.fallbackReason=copy.ok?null:state.reason||globalFallback||"conversion-failed";
        if(copy.ok)diagnostics.convertedMath++;else diagnostics.fallbackMath++;parts.push(speech);outputSegments.push(copy);return;
      }
      const speech=cleanMarkdownText(typeof segment.ttsValue==="string"?segment.ttsValue:segment.value);copy.speech=speech;parts.push(speech);outputSegments.push(copy);
    });
    const text=parts.join("").replace(/\n{3,}/g,"\n\n").trim();
    return{ok:true,version:ADAPTER_VERSION,adapterVersion:ADAPTER_VERSION,text:text,pauseAfterMs:pauseAfterMs,segments:outputSegments,stats:{total:parsed.segments.length,math:parsed.mathCount,convertedMath:diagnostics.convertedMath,fallbackMath:diagnostics.fallbackMath,tables:diagnostics.tables,skipped:diagnostics.skipped.length},diagnostics:diagnostics};
  }
  function cancelledResult(parsed){return{ok:false,version:ADAPTER_VERSION,adapterVersion:ADAPTER_VERSION,cancelled:true,reason:"cancelled",text:"",segments:parsed.segments,stats:{total:parsed.segments.length,math:parsed.mathCount,convertedMath:0,fallbackMath:0,skipped:0},diagnostics:{fallbackReason:"cancelled",convertedMath:0,fallbackMath:0,skipped:[]}}}
  async function requestApi(body,options){
    if(typeof root.fetch!=="function")throw Object.assign(new Error("fetch unavailable"),{code:"api-unavailable"});
    if(options.signal?.aborted)throw Object.assign(new Error("request cancelled"),{code:"cancelled"});
    const controller=typeof root.AbortController==="function"?new root.AbortController():null;let timedOut=false,timer=null,removeAbort=null;
    if(controller&&options.signal&&typeof options.signal.addEventListener==="function"){
      const abort=()=>{try{controller.abort()}catch(error){}};options.signal.addEventListener("abort",abort,{once:true});removeAbort=()=>{try{options.signal.removeEventListener("abort",abort)}catch(error){}};
    }
    if(controller)timer=root.setTimeout(()=>{timedOut=true;try{controller.abort()}catch(error){}},options.timeoutMs);
    const signal=controller?controller.signal:options.signal;
    try{
      const response=await root.fetch("/api/math-speech",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:signal});
      if(timedOut)throw Object.assign(new Error("request timed out"),{code:"timeout"});
      if(options.signal?.aborted)throw Object.assign(new Error("request cancelled"),{code:"cancelled"});
      if(!response||response.ok===false)throw Object.assign(new Error("math speech HTTP error"),{code:"http-error"});
      let data;try{data=await response.json()}catch(error){throw Object.assign(new Error("invalid math speech JSON"),{code:"invalid-json"})}
      if(!data||typeof data!=="object"||data.ok!==true||!Array.isArray(data.segments))throw Object.assign(new Error("math speech response rejected"),{code:"api-error"});
      return data;
    }catch(error){
      if(timedOut)throw Object.assign(new Error("request timed out"),{code:"timeout"});
      if(options.signal?.aborted||error?.name==="AbortError")throw Object.assign(new Error("request cancelled"),{code:options.signal?.aborted?"cancelled":"timeout"});
      throw error;
    }finally{if(timer!==null)root.clearTimeout(timer);if(removeAbort)removeAbort()}
  }
  async function adaptMarkdownForSpeech(input,options){
    const normalized=normalizeOptions(options),parsed=parseMarkdownMath(input);
    if(!parsed.ok){return{ok:false,version:ADAPTER_VERSION,adapterVersion:ADAPTER_VERSION,text:parsed.text||"",segments:parsed.segments||[],stats:{total:parsed.segments?.length||0,math:0,convertedMath:0,fallbackMath:0,skipped:0},diagnostics:{fallbackReason:parsed.reason||"parse-failed",convertedMath:0,fallbackMath:0,skipped:[]},reason:parsed.reason}}
    if(normalized.signal?.aborted)return cancelledResult(parsed);
    if(parsed.mathCount===0)return assemble(parsed,[],null);
    const request=requestSegments(parsed,input,normalized),body={segments:request.segments};
    if(request.segments.length===0)return assemble(parsed,request.localStates,request.limitReason||null);
    let bodyText;try{bodyText=JSON.stringify(body)}catch(error){return assemble(parsed,[],"request-serialization-failed")}
    if(request.segments.length>LIMITS.maxSegments||bodyText.length>LIMITS.maxRequestChars)return assemble(parsed,[],request.segments.length>LIMITS.maxSegments?"segment-limit-exceeded":"request-size-exceeded");
    let data;try{data=await requestApi(body,normalized)}catch(error){if(error?.code==="cancelled")return cancelledResult(parsed);return assemble(parsed,[],error?.code||"request-failed")}
    const states=request.localStates||[];
    request.map.forEach(function(item){
      const parsedIndex=item.parsedIndex,responseIndex=item.responseIndex,inputSegment=parsed.segments[parsedIndex],responseSegment=data.segments[responseIndex];
      if(inputSegment.type!=="math")return;
      if(responseSegment&&responseSegment.type==="math"&&responseSegment.latex===inputSegment.latex&&responseSegment.ok===true&&typeof responseSegment.speech==="string"&&responseSegment.speech.trim())states[parsedIndex]={ok:true,speech:responseSegment.speech,reason:null};
      else states[parsedIndex]={ok:false,speech:safeMathFallback(inputSegment.latex),reason:responseSegment?.diagnostics?.reason||"conversion-failed"};
    });
    return assemble(parsed,states,null);
  }
  async function adapter(input,options){const result=await adaptMarkdownForSpeech(input,options);return result.cancelled?"":result.text}
  adapter.VERSION=ADAPTER_VERSION;
  adapter.parseMarkdown= parseMarkdownMath;
  adapter.adapt=adaptMarkdownForSpeech;
  adapter.safeMathFallback=safeMathFallback;
  adapter.LIMITS=LIMITS;
  root.SocratopiaMathSpeechAdapter=adapter;
})();
